import { Back, Card, EmptyState, Field, Flash, PageHeader, StatusBadge, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import type { ProAppt } from "@/components/ProAppointment";
import { createClient } from "@/lib/supabase/server";
import { formatCOP, formatDateTime } from "@/lib/format";
import { APPOINTMENT_STATUS, CARE_TYPE } from "@/lib/status";
import { professionalDispute, updateProgress } from "@/app/actions/professional";

const NEXT: Record<string, { to: string; label: string }> = {
  confirmed: { to: "en_route", label: "Voy en camino" },
  en_route: { to: "arrived", label: "Llegué al domicilio" },
  arrived: { to: "in_progress", label: "Iniciar atención" },
  in_progress: { to: "completed", label: "Marcar como completada" },
};

export default async function ProCitasPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: up }, { data: hist }] = await Promise.all([
    supabase.rpc("professional_appointments", { p_scope: "upcoming" }),
    supabase.rpc("professional_appointments", { p_scope: "history" }),
  ]);
  const upcoming = (up as ProAppt[]) ?? [];
  const history = (hist as ProAppt[]) ?? [];
  return (
    <>
      <PageHeader title="Mis citas" subtitle="Datos del paciente visibles solo mientras la cita está confirmada o en curso." />
      <Flash searchParams={sp} />
      <h2 className="mb-3 font-display text-lg font-bold">Próximas y en curso</h2>
      <div className="space-y-4">
        {upcoming.length ? upcoming.map((a) => (
          <Card key={a.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-lg font-bold">{formatDateTime(a.starts_at)}</p>
                <p className="text-sm text-ink-soft">{a.specialty} · {CARE_TYPE[a.care_type]} · {a.duration_min} min · <span className="font-mono">{a.code}</span></p>
              </div>
              <StatusBadge map={APPOINTMENT_STATUS} value={a.status} />
            </div>
            <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-soft">Paciente</dt><dd className="font-semibold">{a.patient_name}</dd></div>
              <div><dt className="text-ink-soft">Celular</dt><dd className="font-semibold">{a.patient_phone ? <a className="text-brand-700" href={`tel:${a.patient_phone}`}>{a.patient_phone}</a> : "—"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-ink-soft">Dirección</dt><dd className="font-semibold">{a.address?.address_line} · {[a.address?.neighborhood, a.address?.area_name].filter(Boolean).join(", ")}{a.address?.reference_notes ? ` (${a.address.reference_notes})` : ""}</dd></div>
              {a.patient_notes && <div className="sm:col-span-2"><dt className="text-ink-soft">Motivo</dt><dd>{a.patient_notes}</dd></div>}
            </dl>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {NEXT[a.status] && (
                <form action={updateProgress}><Back to="/profesional/citas" /><input type="hidden" name="appointment_id" value={a.id} /><input type="hidden" name="to" value={NEXT[a.status].to} />
                  <SubmitButton variant={a.status === "in_progress" ? "secondary" : "primary"} confirm={a.status === "in_progress" ? "¿Confirmas que la atención fue prestada?" : undefined}>{NEXT[a.status].label}</SubmitButton>
                </form>
              )}
              <span className="text-sm text-ink-soft">Neto: <strong className="text-emerald-700">{formatCOP(a.professional_net_amount)}</strong></span>
            </div>
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-ink-soft">Reportar un problema (paciente ausente, dirección errada…)</summary>
              <form action={professionalDispute} className="mt-2 space-y-2"><Back to="/profesional/citas" /><input type="hidden" name="appointment_id" value={a.id} />
                <Field label="Descripción"><Textarea name="reason" required maxLength={1000} /></Field><SubmitButton variant="outline" size="sm">Enviar reporte</SubmitButton></form>
            </details>
          </Card>
        )) : <EmptyState title="No tienes citas próximas." />}
      </div>
      <h2 className="mb-3 mt-10 font-display text-lg font-bold">Historial</h2>
      <Card>
        {history.length ? (
          <ul className="divide-y divide-slate-100">
            {history.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>{formatDateTime(a.starts_at)} · {a.specialty} · {a.patient_name ?? "Paciente"} <span className="font-mono text-xs text-ink-faint">{a.code}</span></span>
                <span className="flex items-center gap-3">{a.status === "completed" && <span className="font-semibold text-emerald-700">{formatCOP(a.professional_net_amount)}</span>}<StatusBadge map={APPOINTMENT_STATUS} value={a.status} /></span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-soft">Sin historial.</p>}
      </Card>
    </>
  );
}
