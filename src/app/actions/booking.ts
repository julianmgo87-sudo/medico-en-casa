"use server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { check, num, required, rpc, runAction, str } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { buildCheckoutUrl, isWompiConfigured } from "@/lib/wompi";

export async function addAddress(formData: FormData) {
  const user = await requireRole("patient");
  await runAction(formData, async () => {
    const supabase = await createClient();
    const area = required(formData, "service_area_id", "Barrio / comuna / corregimiento");
    const { data } = check(await supabase.from("patient_addresses").insert({
      patient_id: user.id,
      label: str(formData, "label") || "Casa",
      address_line: required(formData, "address_line", "Dirección"),
      neighborhood: str(formData, "neighborhood") || null,
      reference_notes: str(formData, "reference_notes") || null,
      service_area_id: area,
    }).select("id").single());
    const back = str(formData, "_back");
    if (back.startsWith("/reservar")) {
      const u = new URL(back, "http://x");
      u.searchParams.set("direccion", data!.id);
      u.searchParams.delete("nueva");
      return "redirect:" + u.pathname + u.search;
    }
    return "Dirección guardada.";
  }, "/paciente/perfil");
}

export async function createBookingAndPay(formData: FormData) {
  const user = await requireRole("patient");
  await runAction(formData, async () => {
    if (!isWompiConfigured()) throw new UserError("La pasarela de pagos no está configurada. No es posible pagar todavía.");
    if (formData.get("ack") !== "on") throw new UserError("Debes confirmar que entiendes que el pago no garantiza la aceptación inmediata del profesional.");
    const supabase = await createClient();
    const r = await rpc<{ reference: string; amount_in_cents: number }>(supabase, "create_appointment_hold", {
      p_professional: required(formData, "professional_id", "Profesional"),
      p_care: str(formData, "care_type") === "priority" ? "priority" : "scheduled",
      p_starts_at: required(formData, "starts_at", "Horario"),
      p_duration_min: num(formData, "duration_min"),
      p_address_id: required(formData, "address_id", "Dirección"),
      p_promo: str(formData, "promo_code") || null,
      p_notes: str(formData, "patient_notes").slice(0, 500) || null,
    });
    return "external:" + buildCheckoutUrl({ reference: r.reference, amountInCents: r.amount_in_cents, redirectPath: "/pago/resultado", email: user.email, fullName: user.full_name, phone: user.phone });
  }, "/reservar");
}
