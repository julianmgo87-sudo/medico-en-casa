import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { fetchTransaction, isWompiConfigured, sha256, verifyEventChecksum, type WompiEvent } from "@/lib/wompi";
import { applyVerifiedTransaction } from "@/lib/payments";
import { dispatchPendingEmails } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/**
 * Webhook de eventos de Wompi (configurar en comercios.wompi.co → Desarrolladores → URL de eventos):
 *   https://<dominio>/api/webhooks/wompi
 * 1. Verifica el checksum con WOMPI_EVENTS_SECRET (tiempo constante).
 * 2. Registra el evento con clave única → idempotencia ante reintentos.
 * 3. Vuelve a consultar la transacción en la API de Wompi (fuente de verdad).
 * 4. Aplica el resultado en una transacción de base de datos (valida monto y moneda).
 */
export async function POST(req: NextRequest) {
  if (!isWompiConfigured()) return NextResponse.json({ error: "Pasarela no configurada" }, { status: 503 });
  let event: WompiEvent;
  const raw = await req.text();
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const admin = createAdminClient();
  const valid = verifyEventChecksum(event, serverEnv().wompiEventsSecret);
  const tx = event?.data?.transaction;
  const eventKey = sha256(`${event?.signature?.checksum ?? ""}:${event?.timestamp ?? ""}:${tx?.id ?? ""}:${tx?.status ?? ""}`);

  const { error: insertError } = await admin.from("payment_events").insert({
    provider: "wompi", event_key: eventKey, event_type: event?.event ?? "desconocido",
    provider_transaction_id: tx?.id ?? null, reference: tx?.reference ?? null, signature_valid: valid,
    payload: event as unknown as Record<string, unknown>,
  });
  if (insertError?.code === "23505") return NextResponse.json({ ok: true, duplicate: true });
  if (insertError) {
    console.error("[wompi-webhook] insert", insertError.message);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
  if (!valid) {
    await admin.from("payment_events").update({ processed_at: new Date().toISOString(), processing_result: "firma inválida: ignorado" }).eq("event_key", eventKey);
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }
  if (event.event !== "transaction.updated" || !tx?.id) {
    await admin.from("payment_events").update({ processed_at: new Date().toISOString(), processing_result: "evento no procesado" }).eq("event_key", eventKey);
    return NextResponse.json({ ok: true, ignored: true });
  }

  try {
    const verified = (await fetchTransaction(tx.id)) ?? tx; // si la API no responde, el evento firmado es válido por sí mismo
    if (verified.reference !== tx.reference) throw new Error("La referencia no coincide con la API de Wompi");
    const result = await applyVerifiedTransaction(verified);
    await admin.from("payment_events").update({ processed_at: new Date().toISOString(), processing_result: JSON.stringify(result) }).eq("event_key", eventKey);
    await dispatchPendingEmails(20).catch(() => undefined);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    console.error("[wompi-webhook]", e);
    await admin.from("payment_events").update({ processing_result: `error: ${String(e).slice(0, 300)}` }).eq("event_key", eventKey);
    // 500 → Wompi reintentará; el registro con la misma clave se elimina para permitir el reintento.
    await admin.from("payment_events").delete().eq("event_key", eventKey).is("processed_at", null);
    return NextResponse.json({ error: "Error procesando el evento" }, { status: 500 });
  }
}
