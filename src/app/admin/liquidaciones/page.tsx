import Link from "next/link";
import { Back, Card, Field, Flash, Input, Notice, PageHeader, Select, StatusBadge } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { addDays, bogotaDate, formatCOP, formatDate, formatDateTime } from "@/lib/format";
import { PAYOUT_STATUS } from "@/lib/status";
import { adjustPayout, adminVerifyService, approvePayout, cancelPayout, generatePayouts, markPayoutPaid } from "@/app/actions/admin";

function defaultPeriod(freq: string) {
  const today = bogotaDate();
  const d = new Date(today + "T12:00:00-05:00");
  if (freq === "monthly") {
    const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1, 17));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0, 17));
    return [bogotaDate(first), bogotaDate(last)];
  }
  const dow = (d.getUTCDay() + 6) % 7; // lunes = 0
  const lastMonday = addDays(today, -dow - 7);
  return [freq === "biweekly" ? addDays(lastMonday, -7) : lastMonday, addDays(today, -dow - 1)];
}

export default async function AdminLiquidaciones({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: freqRow } = await supabase.from("application_settings").select("value").eq("key", "payout_frequency").maybeSingle();
  const freq = String(freqRow?.value ?? "weekly");
  const [ps, pe] = defaultPeriod(freq);
  const estado = sp.estado ?? "open";
  let q = supabase.from("professional_payouts")
    .select("*, pro:professional_profiles!professional_payouts_professional_id_fkey(user:users!professional_profiles_user_id_fkey(full_name)), items:payout_items(appointment_id, gross_amount, commission_amount, net_amount, appointment:appointments(code, starts_at, status, patient_confirmed_at, admin_verified_at))")
    .order("created_at", { ascending: false }).limit(100);
  if (estado === "open") q = q.in("status", ["pending", "approved"]);
  else if (estado !== "all") q = q.eq("status", estado);
  const { data: payouts } = await q;
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] : v);
  const back = `/admin/liquidaciones?estado=${estado}`;
  const FREQ: Record<string, string> = { weekly: "semanal", biweekly: "quincenal", monthly: "mensual" };

  return (
    <>
      <PageHeader title="Gestión de liquidaciones" subtitle={`Frecuencia configurada: ${FREQ[freq] ?? freq}. Liquidación manual verificada por el administrador.`} />
      <Flash searchParams={sp} />
      <Card className="mb-6">
        <h2 className="font-display text-lg font-bold">Generar liquidaciones del periodo</h2>
        <p className="mt-1 text-sm text-ink-soft">Incluye solo citas <strong>completadas, pagadas, sin disputa ni reembolso</strong> y que no estén en otra liquidación.</p>
        <form action={generatePayouts} className="mt-3 flex flex-wrap items-end gap-3"><Back to={back} />
          <Field label="Desde"><Input type="date" name="period_start" defaultValue={ps} required /></Field>
          <Field label="Hasta"><Input type="date" name="period_end" defaultValue={pe} required /></Field>
          <SubmitButton>Generar</SubmitButton>
        </form>
      </Card>
      <form method="get" className="mb-4 flex gap-2"><Select name="estado" defaultValue={estado} className="max-w-xs"><option value="open">Pendientes y aprobadas</option><option value="paid">Pagadas</option><option value="cancelled">Canceladas</option><option value="all">Todas</option></Select><button className="rounded-full border px-4 text-sm">Filtrar</button></form>

      <div className="space-y-4">
        {payouts?.length ? payouts.map((p) => {
          const name = one(one(p.pro as never)?.["user"] ?? null) as { full_name: string } | null;
          const items = (p.items ?? []) as { appointment_id: string; net_amount: number; gross_amount: number; commission_amount: number; appointment: unknown }[];
          const acct = p.payout_account_snapshot as { method?: string; bank_name?: string; account_type?: string; account_last4?: string; phone_last4?: string; holder_name?: string } | null;
          return (
            <Card key={p.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-lg font-bold">{name?.full_name}</p>
                  <p className="text-sm text-ink-soft">{formatDate(p.period_start, { dateStyle: "medium" })} – {formatDate(p.period_end, { dateStyle: "medium" })} · {p.items_count} servicios</p>
                  <p className="text-xs text-ink-soft">Cuenta: {acct ? `${acct.method === "bank_account" ? `${acct.bank_name} ${acct.account_type} ****${acct.account_last4}` : `${acct.method} ****${acct.phone_last4}`} · ${acct.holder_name}` : "sin cuenta registrada"}</p>
                </div>
                <div className="text-right">
                  <StatusBadge map={PAYOUT_STATUS} value={p.status} />
                  <p className="mt-1 text-sm">Bruto {formatCOP(p.gross_amount)} − comisión {formatCOP(p.commission_amount)}{Number(p.adjustments_amount) ? ` ${Number(p.adjustments_amount) > 0 ? "+" : "−"} ajuste ${formatCOP(Math.abs(p.adjustments_amount))}` : ""}</p>
                  <p className="font-display text-xl font-bold">Neto {formatCOP(p.net_amount)}</p>
                </div>
              </div>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-semibold text-brand-700">Servicios incluidos</summary>
                <ul className="mt-2 divide-y divide-slate-100">
                  {items.map((i) => {
                    const ap = one(i.appointment as never) as { code: string; starts_at: string; status: string; patient_confirmed_at: string | null; admin_verified_at: string | null } | null;
                    const verified = ap?.patient_confirmed_at || ap?.admin_verified_at;
                    return (
                      <li key={i.appointment_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span><Link className="font-mono text-brand-700" href={`/admin/reservas/${i.appointment_id}`}>{ap?.code}</Link> · {formatDateTime(ap?.starts_at)} · neto {formatCOP(i.net_amount)}</span>
                        {verified ? <span className="text-xs text-teal-700">{ap?.patient_confirmed_at ? "Confirmado por paciente" : "Verificado por admin"}</span> : p.status === "pending" ? (
                          <form action={adminVerifyService}><Back to={back} /><input type="hidden" name="appointment_id" value={i.appointment_id} /><button className="text-xs font-semibold text-amber-700">Sin verificar · Verificar</button></form>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </details>
              {p.status === "pending" && (
                <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
                  <form action={approvePayout}><Back to={back} /><input type="hidden" name="payout_id" value={p.id} /><SubmitButton size="sm" variant="secondary">Aprobar liquidación</SubmitButton></form>
                  <form action={adjustPayout} className="flex flex-wrap items-end gap-2"><Back to={back} /><input type="hidden" name="payout_id" value={p.id} />
                    <Field label="Ajuste (+/−)"><Input name="amount" className="w-28" defaultValue={p.adjustments_amount} /></Field>
                    <Field label="Motivo"><Input name="notes" required defaultValue={p.adjustments_notes ?? ""} /></Field>
                    <SubmitButton size="sm" variant="outline">Guardar ajuste</SubmitButton></form>
                </div>
              )}
              {p.status === "approved" && (
                <form action={markPayoutPaid} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4"><Back to={back} /><input type="hidden" name="payout_id" value={p.id} />
                  <Field label="Medio"><Select name="method"><option value="transferencia">Transferencia bancaria</option><option value="nequi">Nequi</option><option value="daviplata">Daviplata</option></Select></Field>
                  <Field label="Referencia de la transferencia"><Input name="reference" required /></Field>
                  <Field label="Comprobante (PDF/imagen)"><Input type="file" name="receipt" accept="application/pdf,image/jpeg,image/png" /></Field>
                  <SubmitButton size="sm" confirm="¿Confirmas que la transferencia ya se realizó?">Registrar pago</SubmitButton>
                </form>
              )}
              {p.status === "paid" && <p className="mt-3 text-sm text-teal-700">Pagado {formatDateTime(p.paid_at)} · {p.transfer_method} · ref. {p.transfer_reference}{p.receipt_path ? " · comprobante adjunto" : ""}</p>}
              {["pending", "approved"].includes(p.status) && (
                <details className="mt-3 text-sm"><summary className="cursor-pointer text-red-700">Cancelar liquidación</summary>
                  <form action={cancelPayout} className="mt-2 flex gap-2"><Back to={back} /><input type="hidden" name="payout_id" value={p.id} /><Input name="reason" required placeholder="Motivo" /><SubmitButton size="sm" variant="danger">Cancelar</SubmitButton></form>
                </details>
              )}
            </Card>
          );
        }) : <Notice kind="info">No hay liquidaciones en este filtro.</Notice>}
      </div>
    </>
  );
}
