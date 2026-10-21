import { notFound } from "next/navigation";
import { Back, Card, Field, Flash, Input, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { formatCOP, formatDateTime } from "@/lib/format";
import { APPOINTMENT_STATUS, CARE_TYPE, PAYMENT_STATE, PAYMENT_STATUS, REFUND_STATUS } from "@/lib/status";
import { adminCancel, adminReassign, adminResolveDispute, adminVerifyService } from "@/app/actions/admin";

type Alt = { professional_id: string; full_name: string; starts_at: string; total_amount: number; price_difference: number; same_time: boolean };

export default async function AdminReservaDetalle({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: a } = await supabase.from("appointments")
    .select("*, patient:users!appointments_patient_id_fkey(full_name, email, phone), pro:professional_profiles!appointments_professional_id_fkey(user:users!professional_profiles_user_id_fkey(full_name, phone)), specialty:specialties(name)")
    .eq("id", id).maybeSingle();
  if (!a) notFound();
  const [{ data: history }, { data: payments }, { data: refunds }, { data: rejections }, alts] = await Promise.all([
    supabase.from("appointment_status_history").select("*").eq("appointment_id", id).order("created_at"),
    supabase.from("payments").select("*").eq("appointment_id", id).order("created_at"),
    supabase.from("refunds").select("*").eq("appointment_id", id),
    supabase.from("appointment_rejections").select("*").eq("appointment_id", id),
    a.status === "pending_reassignment" ? supabase.rpc("find_alternatives", { p_appointment: id }) : Promise.resolve({ data: [] }),
  ]);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] : v);
  const patient = one(a.patient) as { full_name: string; email: string; phone: string } | null;
  const pro = one(one(a.pro as never)?.["user"] ?? null) as { full_name: string; phone: string } | null;
  const here = `/admin/reservas/${id}`;
  const lines = (a.price_breakdown?.lines ?? []) as { label: string; amount: number }[];

  return (
    <>
      <PageHeader title={`Reserva ${a.code}`} subtitle={`${one(a.specialty)?.name} · ${CARE_TYPE[a.care_type]} · ${formatDateTime(a.starts_at)}`}
        actions={<><StatusBadge map={APPOINTMENT_STATUS} value={a.status} /><span className="text-sm">{PAYMENT_STATE[a.payment_state]}</span></>} />
      <Flash searchParams={sp} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-soft">Paciente</dt><dd className="font-semibold">{patient?.full_name}</dd><dd className="text-xs">{patient?.email} · {patient?.phone}</dd></div>
              <div><dt className="text-ink-soft">Profesional</dt><dd className="font-semibold">{pro?.full_name}</dd><dd className="text-xs">{pro?.phone}</dd></div>
              <div className="sm:col-span-2"><dt className="text-ink-soft">Dirección</dt><dd>{a.address_snapshot?.address_line} · {a.address_snapshot?.neighborhood} · {a.address_snapshot?.area_name}</dd></div>
              {a.patient_notes && <div className="sm:col-span-2"><dt className="text-ink-soft">Motivo</dt><dd>{a.patient_notes}</dd></div>}
              {a.dispute_reason && <div className="sm:col-span-2"><dt className="text-red-700">Disputa</dt><dd>{a.dispute_reason}</dd></div>}
            </dl>
          </Card>
          <Card>
            <h2 className="font-display text-lg font-bold">Desglose congelado</h2>
            <dl className="mt-3 divide-y divide-slate-100 text-sm">
              {lines.map((l, i) => <div key={i} className="flex justify-between py-1.5"><dt>{l.label}</dt><dd>{formatCOP(l.amount)}</dd></div>)}
              <div className="flex justify-between py-1.5 font-bold"><dt>Total paciente</dt><dd>{formatCOP(a.total_amount)}</dd></div>
              <div className="flex justify-between py-1.5"><dt>Comisión ({a.commission_percent} % sobre {formatCOP(a.commission_base_amount)}, base “{a.commission_base_rule}”)</dt><dd>{formatCOP(a.commission_amount)}</dd></div>
              <div className="flex justify-between py-1.5"><dt>Neto profesional</dt><dd>{formatCOP(a.professional_net_amount)}</dd></div>
              <div className="flex justify-between py-1.5"><dt>Pagado / devuelto</dt><dd>{formatCOP(a.amount_paid)} / {formatCOP(a.amount_refunded)}</dd></div>
            </dl>
          </Card>
          <Card>
            <h2 className="font-display text-lg font-bold">Pagos y devoluciones</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {payments?.map((p) => <li key={p.id} className="flex flex-wrap justify-between gap-2"><span className="font-mono text-xs">{p.reference}</span><span>{formatCOP(p.amount)} · {p.payment_method_type ?? "—"}</span><StatusBadge map={PAYMENT_STATUS} value={p.status} /></li>)}
              {refunds?.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-2"><span>Devolución: {r.reason}</span><span>{formatCOP(r.amount)}</span><StatusBadge map={REFUND_STATUS} value={r.status} /></li>)}
            </ul>
            {rejections && rejections.length > 0 && <p className="mt-3 text-sm text-ink-soft">Rechazos/vencimientos: {rejections.map((r) => `${r.kind === "expired" ? "venció" : "rechazó"} (${r.reason ?? ""})`).join(" · ")}</p>}
          </Card>

          {a.status === "pending_reassignment" && (
            <Card>
              <h2 className="font-display text-lg font-bold">Reasignar profesional</h2>
              <p className="mt-1 text-sm text-ink-soft">Solo con aprobación del paciente. Si el valor es menor, la diferencia se devuelve; si es mayor, no se permite.</p>
              <form action={adminReassign} className="mt-3 space-y-3"><Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                <Field label="Alternativa"><Select name="pick" required>
                  {((alts.data as Alt[]) ?? []).map((x) => <option key={x.professional_id + x.starts_at} value={`${x.professional_id}|${x.starts_at}`}>{x.full_name} · {formatDateTime(x.starts_at)} · {formatCOP(x.total_amount)}{Number(x.price_difference) > 0 ? " (mayor valor)" : ""}</option>)}
                </Select></Field>
                <Field label="¿Cómo aprobó el paciente?"><Input name="consent" required placeholder="Llamada telefónica 21/10 10:30, confirmó por WhatsApp…" /></Field>
                <SubmitButton disabled={!(alts.data as Alt[])?.length}>Reasignar</SubmitButton>
              </form>
            </Card>
          )}
          {a.status === "disputed" && (
            <Card className="border-red-200">
              <h2 className="font-display text-lg font-bold">Resolver disputa</h2>
              <form action={adminResolveDispute} className="mt-3 space-y-3"><Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                <Field label="Decisión"><Select name="resolution"><option value="complete">Servicio prestado: liquidar al profesional</option><option value="refund">Devolver el 100 % al paciente</option></Select></Field>
                <Field label="Justificación"><Textarea name="notes" required /></Field>
                <SubmitButton variant="danger" confirm="¿Confirmas la resolución?">Resolver</SubmitButton>
              </form>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          {a.status === "completed" && (
            <Card>
              <h2 className="font-display text-lg font-bold">Verificación del servicio</h2>
              <p className="mt-1 text-sm">Paciente confirmó: <strong>{a.patient_confirmed_at ? formatDateTime(a.patient_confirmed_at) : "no"}</strong></p>
              <p className="text-sm">Verificado por administración: <strong>{a.admin_verified_at ? formatDateTime(a.admin_verified_at) : "no"}</strong></p>
              {!a.admin_verified_at && <form action={adminVerifyService} className="mt-3"><Back to={here} /><input type="hidden" name="appointment_id" value={id} /><SubmitButton size="sm" variant="secondary">Verificar servicio prestado</SubmitButton></form>}
            </Card>
          )}
          {["pending_payment", "pending_acceptance", "professional_assigned", "pending_reassignment", "confirmed"].includes(a.status) && (
            <Card>
              <h2 className="font-display text-lg font-bold">Cancelar (administración)</h2>
              <form action={adminCancel} className="mt-3 space-y-3"><Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                <Field label="Motivo"><Input name="reason" required /></Field>
                <Field label="% a devolver"><Input name="refund_percent" type="number" min={0} max={100} defaultValue={100} /></Field>
                <SubmitButton variant="danger" size="sm" confirm="¿Cancelar la cita?">Cancelar cita</SubmitButton>
              </form>
            </Card>
          )}
          {a.response_deadline && <Notice kind="info">Plazo de respuesta: {formatDateTime(a.response_deadline)}</Notice>}
          <Card>
            <h2 className="font-display text-lg font-bold">Historial</h2>
            <ol className="mt-3 space-y-3 text-sm">
              {history?.map((h) => (
                <li key={h.id}><p className="font-semibold">{APPOINTMENT_STATUS[h.to_status]?.label}</p><p className="text-xs text-ink-soft">{h.reason}</p><p className="text-xs text-ink-faint">{formatDateTime(h.created_at)} · {h.actor_role}{h.changed_by ? ` · ${h.changed_by.slice(0, 8)}` : ""}</p></li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
