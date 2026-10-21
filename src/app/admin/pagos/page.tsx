import Link from "next/link";
import { DateFilters } from "@/components/DateFilters";
import { Back, Card, Field, Flash, Input, Notice, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { addDays, bogotaDate, formatCOP, formatDateTime } from "@/lib/format";
import { PAYMENT_STATUS, REFUND_STATUS } from "@/lib/status";
import { completeRefund, reconcilePayment, refundProcessing } from "@/app/actions/admin";

export default async function AdminPagos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const to = sp.hasta || bogotaDate();
  const from = sp.desde || addDays(to, -30);
  const supabase = await createClient();
  let pq = supabase.from("payments").select("*, patient:users!payments_patient_id_fkey(full_name), appointment:appointments(code)")
    .gte("created_at", `${from}T00:00:00-05:00`).lte("created_at", `${to}T23:59:59-05:00`).order("created_at", { ascending: false }).limit(300);
  if (sp.estado) pq = pq.eq("status", sp.estado);
  const [{ data: payments }, { data: refunds }, { data: events }] = await Promise.all([
    pq,
    supabase.from("refunds").select("*, appointment:appointments(code, id), payment:payments(reference, payment_method_type, provider_transaction_id, patient:users!payments_patient_id_fkey(full_name, email, phone))").in("status", ["pending", "processing"]).order("requested_at"),
    supabase.from("payment_events").select("id, event_type, reference, signature_valid, processing_result, received_at").order("received_at", { ascending: false }).limit(20),
  ]);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] : v);
  const back = `/admin/pagos?desde=${from}&hasta=${to}`;
  return (
    <>
      <PageHeader title="Pagos y reembolsos" subtitle="Los pagos solo se marcan aprobados cuando la pasarela lo confirma (webhook firmado o consulta directa)." />
      <Flash searchParams={sp} />
      <h2 className="mb-3 font-display text-lg font-bold">Reembolsos pendientes</h2>
      <Notice kind="info" className="mb-4">Wompi no ofrece devolución automática para todos los medios (PSE, Nequi). Realiza la devolución desde el panel de Wompi o por transferencia y registra aquí el comprobante. Un reembolso nunca se marca como realizado sin comprobante.</Notice>
      <div className="space-y-3">
        {refunds?.length ? refunds.map((r) => {
          const pay = one(r.payment) as { reference: string; payment_method_type: string; provider_transaction_id: string; patient: unknown } | null;
          const pat = one(pay?.patient as never) as { full_name: string; email: string; phone: string } | null;
          return (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{formatCOP(r.amount)} · {pat?.full_name} <span className="text-xs text-ink-soft">({pat?.email} · {pat?.phone})</span></p>
                  <p className="text-sm text-ink-soft">{r.reason} · Cita <Link className="text-brand-700" href={`/admin/reservas/${one(r.appointment)?.id}`}>{one(r.appointment)?.code}</Link> · Pago {pay?.reference} ({pay?.payment_method_type ?? "—"}, tx {pay?.provider_transaction_id ?? "—"})</p>
                  <p className="text-xs text-ink-faint">Solicitado {formatDateTime(r.requested_at)}</p>
                </div>
                <StatusBadge map={REFUND_STATUS} value={r.status} />
              </div>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                {r.status === "pending" && <form action={refundProcessing}><Back to={back} /><input type="hidden" name="refund_id" value={r.id} /><SubmitButton size="sm" variant="outline">Marcar en proceso</SubmitButton></form>}
                <form action={completeRefund} className="flex flex-wrap items-end gap-2"><Back to={back} /><input type="hidden" name="refund_id" value={r.id} />
                  <Field label="Medio"><Select name="method"><option value="wompi_void">Anulación/devolución en Wompi</option><option value="transferencia">Transferencia bancaria</option><option value="nequi">Nequi</option></Select></Field>
                  <Field label="N.º de comprobante"><Input name="reference" required /></Field>
                  <Field label="Notas"><Input name="notes" /></Field>
                  <SubmitButton size="sm" variant="secondary" confirm="¿Confirmas que la devolución ya fue realizada?">Registrar devolución realizada</SubmitButton>
                </form>
              </div>
            </Card>
          );
        }) : <p className="text-sm text-ink-soft">No hay reembolsos pendientes.</p>}
      </div>

      <h2 className="mb-3 mt-10 font-display text-lg font-bold">Pagos</h2>
      <DateFilters from={from} to={to} extra={<Field label="Estado"><Select name="estado" defaultValue={sp.estado ?? ""}><option value="">Todos</option>{Object.entries(PAYMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>} />
      <Card>
        <Table head={["Fecha", "Referencia", "Concepto", "Paciente", "Medio", "Valor", "Estado", "Conciliación"]} empty={!payments?.length}>
          {payments?.map((p) => (
            <tr key={p.id}>
              <Td>{formatDateTime(p.created_at)}</Td>
              <Td className="font-mono text-xs">{p.reference}<span className="block text-ink-faint">{p.provider_transaction_id}</span></Td>
              <Td>{p.purpose === "membership" ? "Membresía" : `Cita ${one(p.appointment)?.code ?? ""}`}</Td>
              <Td>{one(p.patient)?.full_name}</Td>
              <Td>{p.payment_method_type ?? "—"}</Td>
              <Td className="font-semibold">{formatCOP(p.amount)}</Td>
              <Td><StatusBadge map={PAYMENT_STATUS} value={p.status} />{p.provider_status_message && <span className="block max-w-[200px] text-xs text-ink-soft">{p.provider_status_message}</span>}</Td>
              <Td>{p.status === "approved" && (p.reconciled_at ? <span className="text-xs">Conciliado · comisión {formatCOP(p.provider_fee)}</span> : (
                <form action={reconcilePayment} className="flex gap-1"><Back to={back} /><input type="hidden" name="payment_id" value={p.id} /><Input name="provider_fee" placeholder="Comisión pasarela" className="w-32" inputMode="numeric" /><SubmitButton size="sm" variant="outline">Conciliar</SubmitButton></form>
              ))}</Td>
            </tr>
          ))}
        </Table>
      </Card>

      <h2 className="mb-3 mt-10 font-display text-lg font-bold">Últimos eventos de la pasarela (webhooks)</h2>
      <Card>
        <Table head={["Recibido", "Evento", "Referencia", "Firma", "Resultado"]} empty={!events?.length}>
          {events?.map((e) => <tr key={e.id}><Td>{formatDateTime(e.received_at)}</Td><Td>{e.event_type}</Td><Td className="font-mono text-xs">{e.reference}</Td><Td>{e.signature_valid ? "Válida" : "INVÁLIDA"}</Td><Td className="text-xs">{e.processing_result}</Td></tr>)}
        </Table>
      </Card>
    </>
  );
}
