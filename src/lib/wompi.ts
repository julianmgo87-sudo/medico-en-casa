import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { serverEnv, env } from "@/lib/env";

/**
 * Integración con Wompi (Bancolombia): Web Checkout + eventos (webhooks).
 * Métodos según habilitación del comercio: tarjetas, PSE, Nequi, botón Bancolombia.
 * Documentación: https://docs.wompi.co
 */
export const WOMPI_CHECKOUT_URL = "https://checkout.wompi.co/p/";

export function wompiApiBase() {
  return serverEnv().wompiEnv === "production" ? "https://production.wompi.co/v1" : "https://sandbox.wompi.co/v1";
}

export function isWompiConfigured() {
  const s = serverEnv();
  return Boolean(s.wompiPublicKey && s.wompiPrivateKey && s.wompiIntegritySecret && s.wompiEventsSecret);
}

export function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Firma de integridad: SHA256(referencia + montoEnCentavos + moneda + secretoIntegridad). */
export function integritySignature(reference: string, amountInCents: number, currency: string, secret: string) {
  return sha256(`${reference}${amountInCents}${currency}${secret}`);
}

export function buildCheckoutUrl(opts: { reference: string; amountInCents: number; redirectPath: string; email?: string; fullName?: string; phone?: string | null }) {
  const s = serverEnv();
  if (!isWompiConfigured()) throw new Error("Wompi no está configurado");
  const params = new URLSearchParams({
    "public-key": s.wompiPublicKey,
    currency: "COP",
    "amount-in-cents": String(opts.amountInCents),
    reference: opts.reference,
    "signature:integrity": integritySignature(opts.reference, opts.amountInCents, "COP", s.wompiIntegritySecret),
    "redirect-url": new URL(opts.redirectPath, env.appUrl).toString(),
  });
  if (opts.email) params.set("customer-data:email", opts.email);
  if (opts.fullName) params.set("customer-data:full-name", opts.fullName);
  if (opts.phone) {
    params.set("customer-data:phone-number", opts.phone.replace(/\D/g, "").slice(-10));
    params.set("customer-data:phone-number-prefix", "+57");
  }
  return `${WOMPI_CHECKOUT_URL}?${params.toString()}`;
}

export type WompiTransaction = {
  id: string;
  reference: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "VOIDED" | "ERROR";
  amount_in_cents: number;
  currency: string;
  payment_method_type?: string;
  status_message?: string | null;
};

export type WompiEvent = {
  event: string;
  data: { transaction: WompiTransaction & Record<string, unknown> };
  environment?: string;
  signature: { properties: string[]; checksum: string };
  timestamp: number;
  sent_at?: string;
};

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

/**
 * Verifica el checksum del evento: SHA256(valores de signature.properties tomados
 * de event.data + timestamp + secreto de eventos). Comparación en tiempo constante.
 */
export function verifyEventChecksum(event: WompiEvent, eventsSecret: string) {
  if (!event?.signature?.properties || !event.signature.checksum || !event.timestamp) return false;
  const values = event.signature.properties.map((p) => String(getPath(event.data, p) ?? "")).join("");
  const expected = sha256(`${values}${event.timestamp}${eventsSecret}`);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(event.signature.checksum).toLowerCase(), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Consulta la transacción directamente a Wompi (fuente de verdad). */
export async function fetchTransaction(id: string): Promise<WompiTransaction | null> {
  const s = serverEnv();
  const res = await fetch(`${wompiApiBase()}/transactions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${s.wompiPrivateKey}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: WompiTransaction };
  return body.data ?? null;
}
