import Link from "next/link";
import { StatusBadge } from "@/components/ui";
import { APPOINTMENT_STATUS, CARE_TYPE } from "@/lib/status";
import { formatCOP, formatDateTime } from "@/lib/format";

export type ApptListItem = { id: string; code: string; status: string; care_type: string; starts_at: string; total_amount: number; specialty?: { name: string } | { name: string }[] | null };

export function AppointmentRow({ a, href }: { a: ApptListItem; href: string }) {
  const spec = Array.isArray(a.specialty) ? a.specialty[0] : a.specialty;
  return (
    <Link href={href} className="flex flex-col gap-2 rounded-2xl border border-slate-100 bg-white p-4 shadow-card hover:border-brand-300 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-semibold">{spec?.name ?? "Cita"} <span className="font-mono text-xs text-ink-faint">{a.code}</span></p>
        <p className="text-sm text-ink-soft">{formatDateTime(a.starts_at)} · {CARE_TYPE[a.care_type]}</p>
      </div>
      <div className="flex items-center gap-3"><span className="text-sm font-semibold">{formatCOP(a.total_amount)}</span><StatusBadge map={APPOINTMENT_STATUS} value={a.status} /></div>
    </Link>
  );
}
