import Link from "next/link";
import { Back, Card, EmptyState, Field, Flash, Input, Notice, PageHeader, Select, StatusBadge, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { NotificationsCard } from "@/components/Notifications";
import type { ProAppt } from "@/components/ProAppointment";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCOP, formatDateTime, formatTime } from "@/lib/format";
import { CARE_TYPE, PROFESSIONAL_STATUS, REJECTION_REASONS } from "@/lib/status";
import { respondToAppointment } from "@/app/actions/professional";

export default async function ProfesionalHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireRole("professional");
  const supabase = await createClient();
  const [{ data: profile }, { data: pending }, { data: upcoming }] = await Promise.all([
    supabase.from("professional_profiles").select("status, rejection_reason, approved_hourly_rate").eq("user_id", user.id).single(),
    supabase.rpc("professional_appointments", { p_scope: "pending" }),
    supabase.rpc("professional_appointments", { p_scope: "upcoming" }),
  ]);
  const reqs = (pending as ProAppt[]) ?? [];
  const next = (upcoming as ProAppt[]) ?? [];
  return (
    <>
      {reqs.length > 0 && <meta httpEquiv="refresh" content="60" />}
      <PageHeader title="Solicitudes de cita" subtitle={`Hola, ${user.full_name}`} actions={profile && <StatusBadge map={PROFESSIONAL_STATUS} value={profile.status} />} />
      <Flash searchParams={sp} />
      {profile?.status !== "approved" && (
        <Notice kind={profile?.status === "rejected" ? "error" : "warning"} className="mb-6" title={profile?.status === "pending_review" ? "Tu perfil está en revisión" : profile?.status === "rejected" ? "Tu perfil requiere ajustes" : profile?.status === "suspended" ? "Cuenta suspendida" : "Completa tu perfil"}>
          {profile?.status === "rejected" && <p>{profile.rejection_reason}</p>}
          No recibirás solicitudes hasta que el administrador apruebe tu perfil y documentación. <Link href="/profesional/perfil" className="font-semibold underline">Ir a mi perfil</Link>
        </Notice>
      )}
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Solicitudes pendientes" value={reqs.length} tone={reqs.length ? "amber" : "blue"} />
        <Stat label="Próximas citas" value={next.length} />
        <Stat label="Tarifa aprobada / hora" value={profile?.approved_hourly_rate ? formatCOP(profile.approved_hourly_rate) : "—"} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {reqs.length ? reqs.map((r) => (
            <Card key={r.id} className="border-l-4 border-l-amber-400">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-bold">{formatDateTime(r.starts_at)} – {formatTime(r.ends_at)}</p>
                  <p className="text-sm text-ink-soft">{r.specialty} · {CARE_TYPE[r.care_type]} · {r.duration_min} min · <span className="font-mono">{r.code}</span></p>
                  <p className="mt-1 text-sm">Zona: <strong>{[r.neighborhood, r.area_name].filter(Boolean).join(", ")}</strong></p>
                  {r.patient_notes && <p className="mt-1 text-sm">Motivo: {r.patient_notes}</p>}
                </div>
                <div className="text-right">
                  <p className="text-xs text-ink-soft">Recibirás (neto)</p>
                  <p className="font-display text-xl font-bold text-emerald-700">{formatCOP(r.professional_net_amount)}</p>
                  <p className="text-xs text-ink-soft">Bruto {formatCOP(r.gross_amount)} − comisión {formatCOP(r.commission_amount)}</p>
                </div>
              </div>
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Responde antes de las <strong>{formatDateTime(r.response_deadline)}</strong>. Si no respondes, la solicitud expira.</p>
              <div className="mt-4 space-y-4">
                <form action={respondToAppointment}>
                  <Back to="/profesional" /><input type="hidden" name="appointment_id" value={r.id} /><input type="hidden" name="decision" value="accept" />
                  <SubmitButton size="lg" variant="secondary" className="w-full sm:w-auto">ACEPTAR CITA</SubmitButton>
                </form>
                <form action={respondToAppointment} className="grid gap-3 rounded-2xl border border-red-100 bg-red-50/40 p-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                  <Back to="/profesional" /><input type="hidden" name="appointment_id" value={r.id} /><input type="hidden" name="decision" value="reject" />
                  <Field label="Motivo del rechazo">
                    <Select name="reason" required defaultValue=""><option value="" disabled>Selecciona…</option>{REJECTION_REASONS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</Select>
                  </Field>
                  <Field label="Detalle (obligatorio si eliges “Otro motivo”)"><Input name="notes" maxLength={300} /></Field>
                  <div className="sm:col-span-2"><SubmitButton variant="danger" confirm="¿Rechazar esta cita?">RECHAZAR CITA</SubmitButton></div>
                </form>
              </div>
            </Card>
          )) : <EmptyState title="No tienes solicitudes pendientes.">Las nuevas solicitudes aparecerán aquí y te avisaremos por correo.</EmptyState>}
          {next.length > 0 && <p className="text-sm"><Link href="/profesional/citas" className="font-semibold text-brand-700">Ver mis {next.length} próximas citas →</Link></p>}
        </div>
        <NotificationsCard userId={user.id} back="/profesional" />
      </div>
    </>
  );
}
