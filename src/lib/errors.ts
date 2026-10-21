// Traduce errores de Supabase/PostgreSQL a mensajes seguros para el usuario.
// Solo se muestran mensajes de negocio escritos por nosotros (RAISE EXCEPTION);
// los errores técnicos se registran en el servidor y se muestra un mensaje genérico.
type PgError = { message?: string; code?: string; details?: string } | null | undefined;

const CONSTRAINT_MESSAGES: Record<string, string> = {
  no_professional_overlap: "El horario se cruza con otra cita del profesional.",
  no_patient_overlap: "Ya tienes otra cita activa en ese horario.",
  booking_requires_verification: "Debes registrar la verificación regulatoria antes de habilitar reservas.",
  approved_needs_rate: "Define la tarifa aprobada antes de aprobar.",
  bank_fields: "Completa banco, tipo y número de cuenta.",
  wallet_fields: "Indica el número de celular de la billetera.",
  window_order: "La hora final debe ser posterior a la inicial.",
  exception_order: "La fecha final debe ser posterior a la inicial.",
  scope_target: "Selecciona el destino de la regla (categoría, especialidad o profesional).",
  percent_range: "El porcentaje debe estar entre 0 y 100.",
};

export function friendlyError(error: PgError): string {
  if (!error) return "Ocurrió un error inesperado.";
  const code = error.code ?? "";
  const msg = error.message ?? "";
  for (const [name, text] of Object.entries(CONSTRAINT_MESSAGES)) {
    if (msg.includes(name)) return text;
  }
  if (code === "P0001" || code.startsWith("MC") || code === "42501" || code === "28000") return msg;
  if (code === "23505") return "Este registro ya existe.";
  if (code === "42501" || /permission denied|row-level security/i.test(msg)) return "No tienes permisos para realizar esta acción.";
  console.error("[db-error]", code, msg, error.details);
  return "No se pudo completar la operación. Intenta de nuevo o contacta a soporte.";
}

export class UserError extends Error {}
