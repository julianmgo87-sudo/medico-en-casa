import Link from "next/link";
import type { Metadata } from "next";
import { Card, Notice, StatusBadge, buttonClass } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fetchTransaction, isWompiConfigured } from "@/lib/wompi";
import { applyVerifiedTransaction } from "@/lib/payments";
import { formatCOP, formatDateTime } from "@/lib/format";
import { PAYMENT_STATUS } from "@/lib/status";

export const metadata: Metadata = { title: "Resultado del pago" };
export const dynamic = "force-dynamic";

/**
 * Página de regreso desde Wompi. NO confía en los parámetros de la URL:
 * consulta la transacción directamente a Wompi y aplica el resultado verificado.
 * El webhook firmado hace lo mismo de forma independiente (idempotente).
 */
export default async function PagoResultadoPage({ searchParams }: { searchParams: Promise<{ id?: string; ref?: string }> }) {
  const sp = await searchParams;
  const user = await requireRole("patient");
  const supabase = await createClient();
  let reference = sp.ref ?? null;
  let syncError: string | null = null;

  if (sp.id && isWompiConfigured()) {
    try {
      const tx = await fetchTransaction(sp.id);
      if (tx) {
        reference = tx.reference;
        // Solo sincroniza si la referencia pertenece al usuario actual.
        const { data: own } = await supabase.from("payments").select("id").eq("reference", tx.reference).maybeSingle();
        if (own) await applyVerifiedTransaction(tx);
      } else {
        syncError = "No pudimos consultar la transacción en la pasarela. El resultado se actualizará automáticamente cuando recibamos la notificación.";
      }
    } catch (e) {
      console.error("[pago/resultado]", e);
      syncError = "No pudimos verificar el pago en este momento. El resultado se actualizará automáticamente.";
    }
  }

  const { data: payment } = reference
    ? await supabase.from("payments").select("*").eq("reference", reference).eq("patient_id", user.id).maybeSingle()
    : { data: null };

  const pending = payment && ["pending", "processing"].includes(payment.status);
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      {pending && <meta httpEquiv="refresh" content="8" />}
      <Card>
        <h1 className="font-display text-2xl font-bold">Resultado del pago</h1>
        {syncError && <Notice kind="warning" className="mt-4">{syncError}</Notice>}
        {!payment ? (
          <Notice kind="info" className="mt-4">No encontramos el pago. Revisa tu historial de pagos en unos minutos.</Notice>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between"><span className="text-ink-soft">Estado</span><StatusBadge map={PAYMENT_STATUS} value={payment.status} /></div>
            <div className="flex items-center justify-between"><span className="text-ink-soft">Referencia</span><span className="font-mono text-sm">{payment.reference}</span></div>
            <div className="flex items-center justify-between"><span className="text-ink-soft">Valor</span><span className="font-semibold">{formatCOP(payment.amount)}</span></div>
            {payment.approved_at && <div className="flex items-center justify-between"><span className="text-ink-soft">Aprobado</span><span>{formatDateTime(payment.approved_at)}</span></div>}
            {payment.status === "approved" && payment.purpose === "appointment" && (
              <Notice kind="info" title="Esperando aceptación del profesional">
                Tu pago fue aprobado. El profesional tiene un tiempo límite para aceptar la cita; te avisaremos por correo. Si no puede atenderte, podrás elegir otro profesional o solicitar la devolución completa.
              </Notice>
            )}
            {pending && <Notice kind="warning">El pago está en procesamiento (por ejemplo, PSE). Esta página se actualiza automáticamente.</Notice>}
            {["declined", "error", "voided"].includes(payment.status) && <Notice kind="error">El pago no fue aprobado. No se realizó ningún cobro por esta transacción. {payment.provider_status_message}</Notice>}
          </div>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {payment?.appointment_id && <Link href={`/paciente/citas/${payment.appointment_id}`} className={buttonClass()}>Ver estado de la cita</Link>}
          {payment?.purpose === "membership" && <Link href="/paciente" className={buttonClass()}>Ir a mi panel</Link>}
          <Link href="/paciente/pagos" className={buttonClass({ variant: "outline" })}>Historial de pagos</Link>
        </div>
      </Card>
    </div>
  );
}
