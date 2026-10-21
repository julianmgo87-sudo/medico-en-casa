"use server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { check, num, required, rpc, runAction, str } from "@/lib/actions";
import { UserError } from "@/lib/errors";

const back = (id: string) => `/paciente/citas/${id}`;

export async function cancelAppointment(fd: FormData) {
  await requireRole("patient");
  const id = str(fd, "appointment_id");
  await runAction(fd, async () => {
    const r = await rpc<{ refund_amount: number }>(await createClient(), "cancel_appointment", { p_appointment: id, p_reason: required(fd, "reason", "Motivo") });
    return r.refund_amount > 0 ? "Cita cancelada. La devolución quedó en trámite." : "Cita cancelada.";
  }, back(id));
}

export async function rescheduleAppointment(fd: FormData) {
  await requireRole("patient");
  const id = str(fd, "appointment_id");
  await runAction(fd, async () => {
    await rpc(await createClient(), "reschedule_appointment", { p_appointment: id, p_starts_at: required(fd, "starts_at", "Nuevo horario"), p_accept_new_price: fd.get("accept_price") === "on" });
    return "Solicitud de reprogramación enviada. El profesional debe aceptar el nuevo horario.";
  }, back(id));
}

export async function acceptAlternative(fd: FormData) {
  await requireRole("patient");
  const id = str(fd, "appointment_id");
  await runAction(fd, async () => {
    await rpc(await createClient(), "accept_alternative", { p_appointment: id, p_professional: required(fd, "professional_id", "Profesional"), p_starts_at: required(fd, "starts_at", "Horario"), p_accept_new_price: fd.get("accept_price") === "on" });
    return "Aprobaste el nuevo profesional. Esperando su aceptación.";
  }, back(id));
}

export async function requestRefundInstead(fd: FormData) {
  await requireRole("patient");
  const id = str(fd, "appointment_id");
  await runAction(fd, async () => {
    await rpc(await createClient(), "request_refund_instead", { p_appointment: id });
    return "Solicitaste la devolución completa. Te avisaremos cuando se realice.";
  }, back(id));
}

export async function confirmCompletion(fd: FormData) {
  await requireRole("patient");
  const id = str(fd, "appointment_id");
  await runAction(fd, async () => {
    await rpc(await createClient(), "patient_confirm_completion", { p_appointment: id });
    return "Gracias por confirmar la atención.";
  }, back(id));
}

export async function submitReview(fd: FormData) {
  await requireRole("patient");
  const id = str(fd, "appointment_id");
  await runAction(fd, async () => {
    const rating = num(fd, "rating");
    if (!rating || rating < 1 || rating > 5) throw new UserError("Selecciona una calificación de 1 a 5.");
    await rpc(await createClient(), "submit_review", { p_appointment: id, p_rating: rating, p_comment: str(fd, "comment").slice(0, 1000) });
    return "¡Gracias por tu calificación!";
  }, back(id));
}

export async function openDispute(fd: FormData) {
  await requireRole("patient");
  const id = str(fd, "appointment_id");
  await runAction(fd, async () => {
    await rpc(await createClient(), "open_dispute", { p_appointment: id, p_reason: required(fd, "reason", "Motivo") });
    return "Registramos tu reclamo. El equipo lo revisará y te contactará.";
  }, back(id));
}

export async function updatePatientProfile(fd: FormData) {
  const user = await requireRole("patient");
  await runAction(fd, async () => {
    const supabase = await createClient();
    const phone = required(fd, "phone", "Celular").replace(/\D/g, "").replace(/^57/, "");
    if (!/^3\d{9}$/.test(phone)) throw new UserError("Ingresa un celular colombiano válido.");
    check(await supabase.from("users").update({ full_name: required(fd, "full_name", "Nombre"), phone }).eq("id", user.id));
    check(await supabase.from("patient_profiles").update({
      document_type: str(fd, "document_type") || null, document_number: str(fd, "document_number") || null,
      birth_date: str(fd, "birth_date") || null,
      emergency_contact_name: str(fd, "emergency_contact_name") || null, emergency_contact_phone: str(fd, "emergency_contact_phone") || null,
    }).eq("user_id", user.id));
    return "Perfil actualizado.";
  }, "/paciente/perfil");
}

export async function archiveAddress(fd: FormData) {
  const user = await requireRole("patient");
  await runAction(fd, async () => {
    check(await (await createClient()).from("patient_addresses").update({ is_archived: true, is_default: false }).eq("id", str(fd, "address_id")).eq("patient_id", user.id));
    return "Dirección eliminada.";
  }, "/paciente/perfil");
}

export async function setDefaultAddress(fd: FormData) {
  const user = await requireRole("patient");
  await runAction(fd, async () => {
    const supabase = await createClient();
    check(await supabase.from("patient_addresses").update({ is_default: false }).eq("patient_id", user.id));
    check(await supabase.from("patient_addresses").update({ is_default: true }).eq("id", str(fd, "address_id")).eq("patient_id", user.id));
    return "Dirección principal actualizada.";
  }, "/paciente/perfil");
}
