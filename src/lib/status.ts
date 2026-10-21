export const APPOINTMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending_payment: { label: "Pendiente de pago", tone: "amber" },
  payment_processing: { label: "Pago en procesamiento", tone: "amber" },
  pending_acceptance: { label: "Pendiente de aceptación", tone: "blue" },
  confirmed: { label: "Confirmada", tone: "green" },
  rejected: { label: "Rechazada", tone: "red" },
  expired: { label: "Expirada", tone: "slate" },
  pending_reassignment: { label: "Pendiente de reasignación", tone: "amber" },
  professional_assigned: { label: "Profesional asignado", tone: "blue" },
  en_route: { label: "Profesional en camino", tone: "teal" },
  arrived: { label: "Profesional llegó", tone: "teal" },
  in_progress: { label: "Atención en curso", tone: "teal" },
  completed: { label: "Completada", tone: "green" },
  cancelled: { label: "Cancelada", tone: "slate" },
  refund_pending: { label: "Reembolso pendiente", tone: "amber" },
  refunded: { label: "Reembolsada", tone: "slate" },
  disputed: { label: "En disputa", tone: "red" },
};

export const PAYMENT_STATE: Record<string, string> = {
  unpaid: "Sin pago", processing: "En procesamiento", paid: "Pagado", refund_pending: "Devolución en trámite",
  partially_refunded: "Devolución parcial", refunded: "Devuelto",
};

export const PAYMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "slate" }, processing: { label: "En procesamiento", tone: "amber" },
  approved: { label: "Aprobado", tone: "green" }, declined: { label: "Rechazado", tone: "red" },
  voided: { label: "Anulado", tone: "slate" }, error: { label: "Error", tone: "red" },
};

export const PROFESSIONAL_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: "Borrador", tone: "slate" }, pending_review: { label: "En revisión", tone: "amber" },
  approved: { label: "Aprobado", tone: "green" }, rejected: { label: "Requiere ajustes", tone: "red" },
  suspended: { label: "Suspendido", tone: "red" },
};

export const PAYOUT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "amber" }, approved: { label: "Aprobada", tone: "blue" },
  paid: { label: "Pagado", tone: "green" }, cancelled: { label: "Cancelada", tone: "slate" },
};

export const REFUND_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "amber" }, processing: { label: "En proceso", tone: "blue" },
  completed: { label: "Realizado", tone: "green" }, failed: { label: "Fallido", tone: "red" }, cancelled: { label: "Cancelado", tone: "slate" },
};

export const MEMBERSHIP_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending_payment: { label: "Pendiente de pago", tone: "amber" }, active: { label: "Activa", tone: "green" },
  expired: { label: "Vencida", tone: "slate" }, suspended: { label: "Suspendida", tone: "red" }, cancelled: { label: "Cancelada", tone: "slate" },
};

export const CARE_TYPE: Record<string, string> = { scheduled: "Consulta programada", priority: "Atención prioritaria a domicilio" };

export const REJECTION_REASONS = [
  { value: "no_disponible", label: "No disponible" },
  { value: "desplazamiento", label: "Problema de desplazamiento" },
  { value: "conflicto_agenda", label: "Conflicto de agenda" },
  { value: "fuera_de_alcance", label: "Servicio fuera de mi alcance profesional" },
  { value: "otro", label: "Otro motivo" },
];

export const CREDENTIAL_TYPES: Record<string, string> = {
  title: "Título académico", certification: "Certificación", rethus: "Registro RETHUS",
  id_document: "Documento de identidad", professional_card: "Tarjeta / registro profesional", other: "Otro",
};

export const AREA_TYPES: Record<string, string> = {
  municipio: "Municipio", comuna: "Comuna", barrio: "Barrio", corregimiento: "Corregimiento", zona_rural: "Zona rural",
};

export const PRICING_RULE_TYPES: Record<string, string> = {
  night_surcharge: "Recargo nocturno", weekend_surcharge: "Recargo fin de semana", holiday_surcharge: "Recargo festivo",
  priority_surcharge: "Recargo atención prioritaria", travel_fee: "Recargo adicional de desplazamiento",
  service_fee: "Cargo de servicio", discount: "Descuento / promoción",
};

export const SCOPES: Record<string, string> = {
  global: "General", category: "Por categoría", specialty: "Por especialidad", professional: "Por profesional", care_type: "Por tipo de atención",
};

export type Tone = "blue" | "green" | "amber" | "red" | "slate" | "teal";
