export const TZ = "America/Bogota";

const cop = new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 });

export function formatCOP(value: number | string | null | undefined) {
  return cop.format(Number(value ?? 0));
}

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function formatDate(value: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "long" }) {
  if (!value) return "—";
  const d = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(value + "T12:00:00-05:00") : new Date(value);
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, ...opts }).format(d);
}

export function formatTime(value: string | Date) {
  return new Intl.DateTimeFormat("es-CO", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: true }).format(new Date(value));
}

/** Fecha (YYYY-MM-DD) en Bogotá. */
export function bogotaDate(d: Date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(isoDate: string, days: number) {
  const d = new Date(isoDate + "T12:00:00-05:00");
  d.setUTCDate(d.getUTCDate() + days);
  return bogotaDate(d);
}

export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
