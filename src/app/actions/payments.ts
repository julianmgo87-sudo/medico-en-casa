"use server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { rpc, runAction, str } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { buildCheckoutUrl, isWompiConfigured } from "@/lib/wompi";

type Checkout = { reference: string; amount_in_cents: number; free?: boolean };

function ensureGateway() {
  if (!isWompiConfigured()) {
    throw new UserError("La pasarela de pagos aún no está configurada en este entorno. No es posible pagar todavía.");
  }
}

/** Inicia el pago de una membresía: crea el registro y redirige al checkout de Wompi. */
export async function startMembershipCheckout(formData: FormData) {
  const user = await requireRole("patient");
  await runAction(formData, async () => {
    const supabase = await createClient();
    const { data: plan } = await supabase.from("membership_plans").select("price").eq("id", str(formData, "plan_id")).single();
    if (!plan) throw new UserError("Plan no disponible.");
    if (Number(plan.price) > 0) ensureGateway();
    const r = await rpc<Checkout>(supabase, "create_membership_checkout", { p_plan: str(formData, "plan_id") });
    if (r.free) return "redirect:/paciente?ok=" + encodeURIComponent("Membresía activada.");
    return "external:" + buildCheckoutUrl({ reference: r.reference, amountInCents: r.amount_in_cents, redirectPath: "/pago/resultado", email: user.email, fullName: user.full_name, phone: user.phone });
  }, "/membresias");
}

/** Genera un nuevo intento de pago para una cita en "Pendiente de pago". */
export async function payAppointment(formData: FormData) {
  const user = await requireRole("patient");
  const appointmentId = str(formData, "appointment_id");
  await runAction(formData, async () => {
    ensureGateway();
    const supabase = await createClient();
    const r = await rpc<Checkout>(supabase, "create_appointment_payment", { p_appointment: appointmentId });
    return "external:" + buildCheckoutUrl({ reference: r.reference, amountInCents: r.amount_in_cents, redirectPath: "/pago/resultado", email: user.email, fullName: user.full_name, phone: user.phone });
  }, `/paciente/citas/${appointmentId}`);
}
