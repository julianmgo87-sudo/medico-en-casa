import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WompiTransaction } from "@/lib/wompi";

/**
 * Aplica en la base de datos una transacción YA VERIFICADA con Wompi
 * (firma del webhook válida o consulta directa a la API de Wompi).
 * La función SQL valida monto, moneda, idempotencia y transiciones.
 */
export async function applyVerifiedTransaction(tx: WompiTransaction) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("apply_payment_result", {
    p_reference: tx.reference,
    p_provider_tx_id: tx.id,
    p_status: tx.status,
    p_amount_in_cents: tx.amount_in_cents,
    p_currency: tx.currency,
    p_method: tx.payment_method_type ?? null,
    p_message: tx.status_message ?? null,
  });
  if (error) throw new Error(`apply_payment_result: ${error.message}`);
  return data as { result: string; status?: string; purpose?: string };
}
