import { describe, expect, it, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { buildCheckoutUrl, integritySignature, verifyEventChecksum, type WompiEvent } from "@/lib/wompi";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

beforeAll(() => {
  process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY = "pub_test_x";
  process.env.WOMPI_PRIVATE_KEY = "prv_test_x";
  process.env.WOMPI_INTEGRITY_SECRET = "integ_secret";
  process.env.WOMPI_EVENTS_SECRET = "events_secret";
});

function event(overrides: Partial<WompiEvent["data"]["transaction"]> = {}, secret = "events_secret"): WompiEvent {
  const tx = { id: "1234-1610641025-49201", reference: "CITA-1001-ABCD", status: "APPROVED" as const, amount_in_cents: 11000000, currency: "COP", ...overrides };
  const timestamp = 1530291411;
  return {
    event: "transaction.updated",
    data: { transaction: tx },
    signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"], checksum: sha(`${tx.id}${tx.status}${tx.amount_in_cents}${timestamp}${secret}`) },
    timestamp,
  };
}

describe("Wompi", () => {
  it("calcula la firma de integridad como SHA256(referencia+centavos+moneda+secreto)", () => {
    expect(integritySignature("REF1", 990000, "COP", "s")).toBe(sha("REF1990000COPs"));
  });

  it("acepta un evento con checksum válido", () => {
    expect(verifyEventChecksum(event(), "events_secret")).toBe(true);
  });

  it("rechaza un evento firmado con otro secreto", () => {
    expect(verifyEventChecksum(event({}, "otro"), "events_secret")).toBe(false);
  });

  it("rechaza un evento cuyo monto fue alterado después de firmar", () => {
    const e = event();
    e.data.transaction.amount_in_cents = 100;
    expect(verifyEventChecksum(e, "events_secret")).toBe(false);
  });

  it("rechaza eventos sin firma", () => {
    const e = event();
    // @ts-expect-error evento malformado a propósito
    delete e.signature;
    expect(verifyEventChecksum(e, "events_secret")).toBe(false);
  });

  it("construye la URL de checkout con firma y moneda COP", () => {
    const url = new URL(buildCheckoutUrl({ reference: "MEMB-1", amountInCents: 990000, redirectPath: "/pago/resultado", phone: "300 123 4567" }));
    expect(url.origin + url.pathname).toBe("https://checkout.wompi.co/p/");
    expect(url.searchParams.get("currency")).toBe("COP");
    expect(url.searchParams.get("signature:integrity")).toBe(sha("MEMB-1990000COPinteg_secret"));
    expect(url.searchParams.get("customer-data:phone-number")).toBe("3001234567");
  });
});
