"use server";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { check, num, required, rpc, runAction, str } from "@/lib/actions";
import { UserError } from "@/lib/errors";

async function admin() {
  await requireRole("admin");
  return createClient();
}
const nullable = (v: string) => (v === "" ? null : v);

// ---------------------------------------------------------------- profesionales
export async function reviewCredential(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const { data: u } = await supabase.auth.getUser();
    const approve = str(fd, "decision") === "approve";
    if (!approve && !str(fd, "notes")) throw new UserError("Indica el motivo del rechazo del documento.");
    check(await supabase.from("professional_credentials").update({
      status: approve ? "approved" : "rejected", reviewed_by: u.user!.id, reviewed_at: new Date().toISOString(), review_notes: str(fd, "notes") || null,
    }).eq("id", required(fd, "credential_id", "Documento")));
    return approve ? "Documento aprobado." : "Documento rechazado.";
  });
}

export async function verifyRethus(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const { data: u } = await supabase.auth.getUser();
    const verified = str(fd, "verified") === "1";
    check(await supabase.from("professional_profiles").update({
      rethus_verified_at: verified ? new Date().toISOString() : null, rethus_verified_by: verified ? u.user!.id : null,
    }).eq("user_id", required(fd, "professional_id", "Profesional")));
    return verified ? "RETHUS marcado como verificado." : "Verificación RETHUS retirada.";
  });
}

export async function approveProfessional(fd: FormData) {
  await runAction(fd, async () => {
    const rate = num(fd, "hourly_rate");
    await rpc(await admin(), "admin_approve_professional", { p_professional: required(fd, "professional_id", "Profesional"), p_hourly_rate: rate, p_notes: str(fd, "notes") || null });
    return "Profesional aprobado. Ya puede recibir solicitudes.";
  });
}

export async function rejectProfessional(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "admin_reject_professional", { p_professional: required(fd, "professional_id", "Profesional"), p_reason: required(fd, "reason", "Motivo") });
    return "Se solicitaron ajustes al profesional.";
  });
}

export async function adminUpdateProfessional(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const id = required(fd, "professional_id", "Profesional");
    const specialtyId = required(fd, "specialty_id", "Especialidad");
    const { data: spec } = await supabase.from("specialties").select("category_id").eq("id", specialtyId).single();
    check(await supabase.from("users").update({ full_name: required(fd, "full_name", "Nombre") }).eq("id", id));
    check(await supabase.from("professional_profiles").update({
      profession: required(fd, "profession", "Profesión"), specialty_id: specialtyId, category_id: spec?.category_id,
      professional_registration: nullable(str(fd, "professional_registration")), rethus_number: nullable(str(fd, "rethus_number")),
      document_type: nullable(str(fd, "document_type")), document_number: nullable(str(fd, "document_number")),
      years_experience: num(fd, "years_experience"), bio: str(fd, "bio"), approved_hourly_rate: num(fd, "approved_hourly_rate"),
      default_duration_min: num(fd, "default_duration_min") ?? 60, travel_buffer_min: num(fd, "travel_buffer_min") ?? 30,
    }).eq("user_id", id));
    return "Perfil actualizado (registrado en auditoría).";
  });
}

export async function adminUploadPhoto(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const id = required(fd, "professional_id", "Profesional");
    const file = fd.get("photo");
    if (!(file instanceof File) || !file.size) throw new UserError("Selecciona una imagen.");
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024) throw new UserError("Imagen JPG/PNG/WEBP de máximo 3 MB.");
    const path = `${id}/foto-${Date.now()}.${file.type.split("/")[1].replace("jpeg", "jpg")}`;
    const up = await supabase.storage.from("professional-photos").upload(path, file, { contentType: file.type });
    if (up.error) throw new UserError("No se pudo subir la foto.");
    check(await supabase.from("professional_profiles").update({ photo_path: path }).eq("user_id", id));
    return "Foto actualizada.";
  });
}

export async function adminAddCredential(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const id = required(fd, "professional_id", "Profesional");
    const file = fd.get("file");
    let path: string | null = null;
    if (file instanceof File && file.size) {
      if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new UserError("Archivo PDF/JPG/PNG de máximo 10 MB.");
      path = `${id}/${Date.now()}-admin.${file.type === "application/pdf" ? "pdf" : file.type.split("/")[1]}`;
      const up = await supabase.storage.from("professional-documents").upload(path, file, { contentType: file.type });
      if (up.error) throw new UserError("No se pudo subir el archivo.");
    }
    check(await supabase.from("professional_credentials").insert({
      professional_id: id, credential_type: required(fd, "credential_type", "Tipo"), title: required(fd, "title", "Título"),
      institution: nullable(str(fd, "institution")), issued_on: nullable(str(fd, "issued_on")), file_path: path, status: "pending",
    }));
    return "Credencial agregada (pendiente de aprobación).";
  });
}

export async function verifyPayoutAccount(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const { data: u } = await supabase.auth.getUser();
    check(await supabase.from("professional_payout_accounts").update({ verified_at: new Date().toISOString(), verified_by: u.user!.id }).eq("professional_id", required(fd, "professional_id", "Profesional")));
    return "Cuenta de pago verificada.";
  });
}

export async function setUserStatus(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "admin_set_user_status", { p_user: required(fd, "user_id", "Usuario"), p_status: required(fd, "status", "Estado"), p_reason: str(fd, "reason") || null });
    return str(fd, "status") === "suspended" ? "Usuario suspendido." : "Usuario reactivado.";
  });
}

export async function reactivateProfessional(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    check(await supabase.from("professional_profiles").update({ status: "pending_review" }).eq("user_id", required(fd, "professional_id", "Profesional")).eq("status", "suspended"));
    return "Perfil devuelto a revisión. Apruébalo nuevamente para habilitarlo.";
  });
}

export async function setUserRole(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const role = required(fd, "role", "Rol");
    if (!["patient", "admin"].includes(role)) throw new UserError("Rol inválido.");
    if (str(fd, "confirm") !== "CONFIRMAR") throw new UserError('Escribe CONFIRMAR para cambiar el rol.');
    check(await supabase.from("users").update({ role }).eq("id", required(fd, "user_id", "Usuario")));
    return "Rol actualizado.";
  });
}

// ---------------------------------------------------------------- membresías
export async function grantMembership(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "admin_grant_membership", { p_patient: required(fd, "patient_id", "Paciente"), p_days: num(fd, "days"), p_notes: required(fd, "notes", "Motivo") });
    return "Membresía otorgada.";
  });
}

export async function setMembershipStatus(fd: FormData) {
  await runAction(fd, async () => {
    const status = required(fd, "status", "Estado");
    if (!["active", "suspended", "cancelled"].includes(status)) throw new UserError("Estado inválido.");
    check(await (await admin()).from("patient_memberships").update({ status, cancelled_at: status === "cancelled" ? new Date().toISOString() : null, notes: str(fd, "notes") || null }).eq("id", required(fd, "membership_id", "Membresía")));
    return "Membresía actualizada.";
  });
}

export async function savePlan(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const row = {
      code: required(fd, "code", "Código").toLowerCase().replace(/[^a-z0-9-]/g, "-"), name: required(fd, "name", "Nombre"),
      description: str(fd, "description"), period_type: required(fd, "period_type", "Periodo"),
      duration_days: num(fd, "duration_days"), price: num(fd, "price"), is_active: fd.get("is_active") === "on",
      is_promotional: fd.get("is_promotional") === "on", sort_order: num(fd, "sort_order") ?? 0,
    };
    if (!row.duration_days || row.price === null) throw new UserError("Define duración y precio.");
    const id = str(fd, "id");
    check(id ? await supabase.from("membership_plans").update(row).eq("id", id) : await supabase.from("membership_plans").insert(row));
    return "Plan guardado. Los pagos ya realizados conservan su precio.";
  });
}

// ---------------------------------------------------------------- precios y comisiones
export async function savePricingRule(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const scope = required(fd, "scope", "Alcance");
    const row = {
      name: required(fd, "name", "Nombre"), rule_type: required(fd, "rule_type", "Tipo"), scope,
      category_id: scope === "category" ? required(fd, "category_id", "Categoría") : null,
      specialty_id: scope === "specialty" ? required(fd, "specialty_id", "Especialidad") : null,
      professional_id: scope === "professional" ? required(fd, "professional_id", "Profesional") : null,
      value_type: required(fd, "value_type", "Tipo de valor"), value: num(fd, "value"),
      promo_code: nullable(str(fd, "promo_code").toUpperCase()),
      valid_from: nullable(str(fd, "valid_from")) && new Date(`${str(fd, "valid_from")}T00:00:00-05:00`).toISOString(),
      valid_until: nullable(str(fd, "valid_until")) && new Date(`${str(fd, "valid_until")}T23:59:59-05:00`).toISOString(),
      is_active: true,
    };
    if (row.value === null) throw new UserError("Define el valor.");
    check(await supabase.from("pricing_rules").insert(row));
    return "Regla creada. Aplica solo a reservas nuevas.";
  });
}

export async function toggleRow(fd: FormData) {
  await runAction(fd, async () => {
    const table = required(fd, "table", "Tabla");
    const allowed = ["pricing_rules", "commissions", "membership_plans", "service_categories", "specialties", "service_areas", "reviews"];
    if (!allowed.includes(table)) throw new UserError("Operación no permitida.");
    const column = table === "reviews" ? "is_visible" : "is_active";
    check(await (await admin()).from(table).update({ [column]: str(fd, "value") === "1" }).eq("id", required(fd, "id", "Registro")));
    return "Actualizado.";
  });
}

export async function setProfessionalRate(fd: FormData) {
  await runAction(fd, async () => {
    const rate = num(fd, "approved_hourly_rate");
    if (!rate || rate <= 0) throw new UserError("Tarifa inválida.");
    check(await (await admin()).from("professional_profiles").update({ approved_hourly_rate: rate }).eq("user_id", required(fd, "professional_id", "Profesional")));
    return "Tarifa final actualizada. Las reservas existentes conservan su precio.";
  });
}

export async function saveSpecialtyRate(fd: FormData) {
  await runAction(fd, async () => {
    check(await (await admin()).from("specialties").update({ default_hourly_rate: num(fd, "default_hourly_rate"), default_duration_min: num(fd, "default_duration_min") ?? 60 }).eq("id", required(fd, "id", "Especialidad")));
    return "Tarifa de referencia actualizada.";
  });
}

export async function saveHoliday(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    if (str(fd, "delete") === "1") check(await supabase.from("holidays").delete().eq("day", required(fd, "day", "Fecha")));
    else check(await supabase.from("holidays").upsert({ day: required(fd, "day", "Fecha"), name: required(fd, "name", "Nombre") }));
    return "Festivos actualizados.";
  });
}

export async function saveCommission(fd: FormData) {
  await runAction(fd, async () => {
    const scope = required(fd, "scope", "Alcance");
    const row = {
      name: required(fd, "name", "Nombre"), scope, percent: num(fd, "percent"),
      category_id: scope === "category" ? required(fd, "category_id", "Categoría") : null,
      specialty_id: scope === "specialty" ? required(fd, "specialty_id", "Especialidad") : null,
      professional_id: scope === "professional" ? required(fd, "professional_id", "Profesional") : null,
      care_type: scope === "care_type" ? required(fd, "care_type", "Tipo de atención") : null,
    };
    if (row.percent === null || row.percent < 0 || row.percent > 100) throw new UserError("Porcentaje entre 0 y 100.");
    const supabase = await admin();
    // Una comisión activa por destino: desactiva la anterior del mismo alcance/destino.
    let q = supabase.from("commissions").update({ is_active: false }).eq("scope", scope).eq("is_active", true);
    q = row.category_id ? q.eq("category_id", row.category_id) : row.specialty_id ? q.eq("specialty_id", row.specialty_id) : row.professional_id ? q.eq("professional_id", row.professional_id) : row.care_type ? q.eq("care_type", row.care_type) : q;
    check(await q);
    check(await supabase.from("commissions").insert(row));
    return "Comisión guardada. Aplica solo a reservas nuevas; las existentes conservan su comisión.";
  });
}

// ---------------------------------------------------------------- configuración
export async function saveSettings(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const { data: u } = await supabase.auth.getUser();
    const { data: current } = await supabase.from("application_settings").select("key, value");
    for (const row of current ?? []) {
      if (!fd.has(`s_${row.key}`)) continue;
      const raw = str(fd, `s_${row.key}`);
      let value: unknown;
      if (typeof row.value === "boolean") value = raw === "true";
      else if (typeof row.value === "number") { value = Number(raw); if (!Number.isFinite(value as number)) throw new UserError(`Valor inválido para ${row.key}.`); }
      else if (typeof row.value === "object") { try { value = JSON.parse(raw); } catch { throw new UserError(`JSON inválido en ${row.key}.`); } }
      else value = raw;
      if (JSON.stringify(value) !== JSON.stringify(row.value)) {
        check(await supabase.from("application_settings").update({ value, updated_by: u.user!.id }).eq("key", row.key));
      }
    }
    return "Configuración guardada.";
  });
}

export async function saveCategory(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const row = {
      name: required(fd, "name", "Nombre"), slug: required(fd, "slug", "Slug").toLowerCase().replace(/[^a-z0-9-]/g, "-"),
      description: str(fd, "description"), icon: str(fd, "icon") || "stethoscope", sort_order: num(fd, "sort_order") ?? 0,
      regulatory_notes: str(fd, "regulatory_notes"),
    };
    const id = str(fd, "id");
    check(id ? await supabase.from("service_categories").update(row).eq("id", id) : await supabase.from("service_categories").insert(row));
    return "Categoría guardada.";
  });
}

export async function setCategoryBooking(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const { data: u } = await supabase.auth.getUser();
    const enable = str(fd, "enable") === "1";
    if (enable && fd.get("verified") !== "on") throw new UserError("Confirma que verificaste los requisitos regulatorios del servicio domiciliario.");
    check(await supabase.from("service_categories").update(enable
      ? { booking_enabled: true, regulatory_verified_at: new Date().toISOString(), regulatory_verified_by: u.user!.id }
      : { booking_enabled: false }).eq("id", required(fd, "id", "Categoría")));
    return enable ? "Reservas habilitadas para esta categoría." : "Reservas deshabilitadas.";
  });
}

export async function saveSpecialty(fd: FormData) {
  await runAction(fd, async () => {
    check(await (await admin()).from("specialties").insert({
      category_id: required(fd, "category_id", "Categoría"), name: required(fd, "name", "Nombre"),
      slug: required(fd, "slug", "Slug").toLowerCase().replace(/[^a-z0-9-]/g, "-"), description: str(fd, "description"),
      default_hourly_rate: num(fd, "default_hourly_rate"), default_duration_min: num(fd, "default_duration_min") ?? 60,
    }));
    return "Especialidad creada.";
  });
}

export async function saveArea(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const row = {
      name: required(fd, "name", "Nombre"), area_type: required(fd, "area_type", "Tipo"), parent_id: nullable(str(fd, "parent_id")),
      municipality: str(fd, "municipality") || "Palmira", department: str(fd, "department") || "Valle del Cauca", travel_fee: num(fd, "travel_fee") ?? 0,
    };
    const id = str(fd, "id");
    check(id ? await supabase.from("service_areas").update({ travel_fee: row.travel_fee, name: row.name }).eq("id", id) : await supabase.from("service_areas").insert(row));
    return "Zona guardada.";
  });
}

// ---------------------------------------------------------------- reservas
export async function adminReassign(fd: FormData) {
  await runAction(fd, async () => {
    const [professional, startsAt] = required(fd, "pick", "Alternativa").split("|");
    await rpc(await admin(), "admin_reassign_appointment", { p_appointment: required(fd, "appointment_id", "Cita"), p_professional: professional, p_starts_at: startsAt, p_patient_consent_note: required(fd, "consent", "Aprobación del paciente") });
    return "Cita reasignada. Esperando aceptación del nuevo profesional.";
  });
}

export async function adminCancel(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "cancel_appointment", { p_appointment: required(fd, "appointment_id", "Cita"), p_reason: required(fd, "reason", "Motivo"), p_admin_refund_percent: num(fd, "refund_percent") ?? 100 });
    return "Cita cancelada.";
  });
}

export async function adminResolveDispute(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "admin_resolve_dispute", { p_appointment: required(fd, "appointment_id", "Cita"), p_resolution: required(fd, "resolution", "Resolución"), p_notes: required(fd, "notes", "Justificación") });
    return "Disputa resuelta.";
  });
}

export async function adminVerifyService(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "admin_verify_appointment", { p_appointment: required(fd, "appointment_id", "Cita") });
    return "Servicio verificado.";
  });
}

// ---------------------------------------------------------------- pagos y reembolsos
export async function completeRefund(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "admin_complete_refund", { p_refund: required(fd, "refund_id", "Reembolso"), p_method: required(fd, "method", "Medio"), p_provider_reference: required(fd, "reference", "Comprobante"), p_notes: str(fd, "notes") || null });
    return "Devolución registrada como realizada.";
  });
}

export async function refundProcessing(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "admin_set_refund_processing", { p_refund: required(fd, "refund_id", "Reembolso"), p_notes: str(fd, "notes") || null });
    return "Reembolso marcado en proceso.";
  });
}

export async function reconcilePayment(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "admin_reconcile_payment", { p_payment: required(fd, "payment_id", "Pago"), p_provider_fee: num(fd, "provider_fee") ?? 0 });
    return "Pago conciliado.";
  });
}

// ---------------------------------------------------------------- liquidaciones
export async function generatePayouts(fd: FormData) {
  await runAction(fd, async () => {
    const r = await rpc<{ payouts_created: number }>(await admin(), "generate_payouts", { p_period_start: required(fd, "period_start", "Desde"), p_period_end: required(fd, "period_end", "Hasta") });
    return r.payouts_created ? `Se generaron ${r.payouts_created} liquidaciones pendientes.` : "No hay servicios completados pendientes de liquidar en ese periodo.";
  });
}

export async function approvePayout(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "approve_payout", { p_payout: required(fd, "payout_id", "Liquidación") });
    return "Liquidación aprobada.";
  });
}

export async function adjustPayout(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "admin_set_payout_adjustment", { p_payout: required(fd, "payout_id", "Liquidación"), p_amount: num(fd, "amount") ?? 0, p_notes: required(fd, "notes", "Motivo") });
    return "Ajuste registrado.";
  });
}

export async function markPayoutPaid(fd: FormData) {
  await runAction(fd, async () => {
    const supabase = await admin();
    const id = required(fd, "payout_id", "Liquidación");
    const { data: po } = await supabase.from("professional_payouts").select("professional_id").eq("id", id).single();
    let receipt: string | null = null;
    const file = fd.get("receipt");
    if (file instanceof File && file.size) {
      if (!["application/pdf", "image/jpeg", "image/png"].includes(file.type) || file.size > 10 * 1024 * 1024) throw new UserError("Comprobante PDF/JPG/PNG de máximo 10 MB.");
      receipt = `${po!.professional_id}/${id}-${Date.now()}.${file.type === "application/pdf" ? "pdf" : file.type.split("/")[1]}`;
      const up = await supabase.storage.from("payout-receipts").upload(receipt, file, { contentType: file.type });
      if (up.error) throw new UserError("No se pudo subir el comprobante.");
    }
    await rpc(supabase, "mark_payout_paid", { p_payout: id, p_method: required(fd, "method", "Medio"), p_reference: required(fd, "reference", "Referencia de transferencia"), p_receipt_path: receipt });
    return "Liquidación marcada como pagada.";
  });
}

export async function cancelPayout(fd: FormData) {
  await runAction(fd, async () => {
    await rpc(await admin(), "cancel_payout", { p_payout: required(fd, "payout_id", "Liquidación"), p_reason: required(fd, "reason", "Motivo") });
    return "Liquidación cancelada. Sus servicios vuelven a estar disponibles para liquidar.";
  });
}
