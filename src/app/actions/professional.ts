"use server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { check, num, required, rpc, runAction, str } from "@/lib/actions";
import { UserError } from "@/lib/errors";

const ALLOWED = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

function fileExt(f: File) {
  return f.type === "application/pdf" ? "pdf" : f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
}

export async function respondToAppointment(fd: FormData) {
  await requireRole("professional");
  await runAction(fd, async () => {
    const accept = str(fd, "decision") === "accept";
    await rpc(await createClient(), "respond_to_appointment", {
      p_appointment: required(fd, "appointment_id", "Cita"), p_accept: accept,
      p_reason: accept ? null : required(fd, "reason", "Motivo del rechazo"), p_notes: str(fd, "notes") || null,
    });
    return accept ? "Cita aceptada y confirmada al paciente." : "Rechazo registrado. El sistema ofrecerá alternativas al paciente.";
  }, "/profesional");
}

export async function updateProgress(fd: FormData) {
  await requireRole("professional");
  await runAction(fd, async () => {
    await rpc(await createClient(), "update_service_progress", { p_appointment: required(fd, "appointment_id", "Cita"), p_to: required(fd, "to", "Estado") });
    return "Estado actualizado.";
  }, "/profesional/citas");
}

export async function professionalDispute(fd: FormData) {
  await requireRole("professional");
  await runAction(fd, async () => {
    await rpc(await createClient(), "open_dispute", { p_appointment: required(fd, "appointment_id", "Cita"), p_reason: required(fd, "reason", "Motivo") });
    return "Reporte enviado al administrador.";
  }, "/profesional/citas");
}

export async function saveProfessionalProfile(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    const supabase = await createClient();
    const phone = str(fd, "phone").replace(/\D/g, "").replace(/^57/, "");
    check(await supabase.from("users").update({ full_name: required(fd, "full_name", "Nombre"), phone: phone || null }).eq("id", user.id));
    const specialtyId = required(fd, "specialty_id", "Especialidad");
    const { data: spec } = await supabase.from("specialties").select("category_id").eq("id", specialtyId).single();
    if (!spec) throw new UserError("Especialidad inválida.");
    const duration = num(fd, "default_duration_min") ?? 60;
    if (duration < 15 || duration > 480) throw new UserError("La duración debe estar entre 15 y 480 minutos.");
    const { data: current } = await supabase.from("professional_profiles").select("status").eq("user_id", user.id).single();
    const base = {
      bio: str(fd, "bio").slice(0, 2000), years_experience: num(fd, "years_experience"),
      proposed_hourly_rate: num(fd, "proposed_hourly_rate"), default_duration_min: duration,
      travel_buffer_min: num(fd, "travel_buffer_min") ?? 30,
    };
    // Los datos de credenciales de un perfil aprobado solo los cambia el administrador.
    const sensitive = current?.status === "approved" ? {} : {
      profession: required(fd, "profession", "Profesión"), category_id: spec.category_id, specialty_id: specialtyId,
      document_type: str(fd, "document_type") || null, document_number: str(fd, "document_number") || null,
      professional_registration: str(fd, "professional_registration") || null, rethus_number: str(fd, "rethus_number") || null,
    };
    check(await supabase.from("professional_profiles").update({ ...base, ...sensitive }).eq("user_id", user.id));

    const zones = fd.getAll("zones").map(String);
    check(await supabase.from("professional_service_areas").delete().eq("professional_id", user.id));
    if (zones.length) check(await supabase.from("professional_service_areas").insert(zones.map((z) => ({ professional_id: user.id, service_area_id: z }))));
    return "Perfil guardado.";
  }, "/profesional/perfil");
}

export async function uploadPhoto(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    const file = fd.get("photo");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Selecciona una imagen.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new UserError("La foto debe ser JPG, PNG o WEBP.");
    if (file.size > 3 * 1024 * 1024) throw new UserError("La foto no puede superar 3 MB.");
    const supabase = await createClient();
    const path = `${user.id}/foto-${Date.now()}.${fileExt(file)}`;
    const up = await supabase.storage.from("professional-photos").upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw new UserError("No se pudo subir la foto.");
    check(await supabase.from("professional_profiles").update({ photo_path: path }).eq("user_id", user.id));
    return "Foto actualizada.";
  }, "/profesional/perfil");
}

export async function uploadCredential(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new UserError("Adjunta el documento de soporte.");
    if (!ALLOWED.includes(file.type)) throw new UserError("El documento debe ser PDF, JPG o PNG.");
    if (file.size > 10 * 1024 * 1024) throw new UserError("El archivo no puede superar 10 MB.");
    const supabase = await createClient();
    const path = `${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${fileExt(file)}`;
    const up = await supabase.storage.from("professional-documents").upload(path, file, { contentType: file.type });
    if (up.error) throw new UserError("No se pudo subir el documento.");
    check(await supabase.from("professional_credentials").insert({
      professional_id: user.id, credential_type: required(fd, "credential_type", "Tipo"), title: required(fd, "title", "Título"),
      institution: str(fd, "institution") || null, issued_on: str(fd, "issued_on") || null, file_path: path,
    }));
    return "Documento cargado. Quedó pendiente de revisión.";
  }, "/profesional/perfil");
}

export async function deleteCredential(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    check(await (await createClient()).from("professional_credentials").delete().eq("id", str(fd, "credential_id")).eq("professional_id", user.id).eq("status", "pending"));
    return "Documento eliminado.";
  }, "/profesional/perfil");
}

export async function savePayoutAccount(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    const supabase = await createClient();
    const method = required(fd, "method", "Medio de pago");
    const row = {
      professional_id: user.id, method,
      bank_name: method === "bank_account" ? required(fd, "bank_name", "Banco") : null,
      account_type: method === "bank_account" ? required(fd, "account_type", "Tipo de cuenta") : null,
      account_number: method === "bank_account" ? required(fd, "account_number", "Número de cuenta").replace(/\D/g, "") : null,
      phone_number: method !== "bank_account" ? required(fd, "phone_number", "Celular").replace(/\D/g, "") : null,
      holder_name: required(fd, "holder_name", "Titular"), holder_document: required(fd, "holder_document", "Documento del titular"),
    };
    const { data: existing } = await supabase.from("professional_payout_accounts").select("professional_id").eq("professional_id", user.id).maybeSingle();
    check(existing
      ? await supabase.from("professional_payout_accounts").update(row).eq("professional_id", user.id)
      : await supabase.from("professional_payout_accounts").insert(row));
    return "Datos de pago guardados. El administrador debe verificarlos antes de la primera transferencia.";
  }, "/profesional/perfil");
}

export async function submitForReview(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    const supabase = await createClient();
    const [{ data: p }, { count: creds }, { count: zones }, { count: windows }] = await Promise.all([
      supabase.from("professional_profiles").select("specialty_id, profession, proposed_hourly_rate, document_number, rethus_number").eq("user_id", user.id).single(),
      supabase.from("professional_credentials").select("id", { count: "exact", head: true }).eq("professional_id", user.id),
      supabase.from("professional_service_areas").select("service_area_id", { count: "exact", head: true }).eq("professional_id", user.id),
      supabase.from("professional_availability").select("id", { count: "exact", head: true }).eq("professional_id", user.id),
    ]);
    const missing = [
      !p?.specialty_id && "especialidad", !p?.profession && "profesión", !p?.proposed_hourly_rate && "tarifa propuesta",
      !p?.document_number && "documento de identidad", !p?.rethus_number && "número RETHUS",
      !creds && "documentos de soporte", !zones && "zonas de atención", !windows && "horarios de disponibilidad",
    ].filter(Boolean);
    if (missing.length) throw new UserError(`Completa antes de enviar: ${missing.join(", ")}.`);
    check(await supabase.from("professional_profiles").update({ status: "pending_review" }).eq("user_id", user.id));
    return "Perfil enviado a revisión. Te avisaremos por correo.";
  }, "/profesional/perfil");
}

export async function addAvailability(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    const days = fd.getAll("weekday").map(Number);
    if (!days.length) throw new UserError("Selecciona al menos un día.");
    const start = required(fd, "start_time", "Hora inicial");
    const end = required(fd, "end_time", "Hora final");
    if (end <= start) throw new UserError("La hora final debe ser posterior a la inicial.");
    check(await (await createClient()).from("professional_availability").insert(days.map((d) => ({
      professional_id: user.id, weekday: d, start_time: start, end_time: end,
      valid_from: str(fd, "valid_from") || undefined, valid_until: str(fd, "valid_until") || null,
    }))));
    return "Horario agregado.";
  }, "/profesional/agenda");
}

export async function removeAvailability(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    check(await (await createClient()).from("professional_availability").delete().eq("id", str(fd, "id")).eq("professional_id", user.id));
    return "Horario eliminado. Las citas ya reservadas se mantienen.";
  }, "/profesional/agenda");
}

export async function addException(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    const from = required(fd, "starts_at", "Desde");
    const to = required(fd, "ends_at", "Hasta");
    // Los campos datetime-local se interpretan en hora de Colombia (UTC−5).
    const startsAt = new Date(`${from}:00-05:00`);
    const endsAt = new Date(`${to}:00-05:00`);
    if (!(endsAt > startsAt)) throw new UserError("La fecha final debe ser posterior a la inicial.");
    check(await (await createClient()).from("availability_exceptions").insert({ professional_id: user.id, starts_at: startsAt.toISOString(), ends_at: endsAt.toISOString(), reason: str(fd, "reason") || null }));
    return "Bloqueo agregado. Las citas ya confirmadas en ese periodo no se cancelan automáticamente.";
  }, "/profesional/agenda");
}

export async function removeException(fd: FormData) {
  const user = await requireRole("professional");
  await runAction(fd, async () => {
    check(await (await createClient()).from("availability_exceptions").delete().eq("id", str(fd, "id")).eq("professional_id", user.id));
    return "Bloqueo eliminado.";
  }, "/profesional/agenda");
}
