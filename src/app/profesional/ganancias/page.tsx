import { Card, PageHeader, Stat, StatusBadge, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCOP, formatDate, formatDateTime } from "@/lib/format";
import { PAYOUT_STATUS } from "@/lib/status";

type Summary = { completed_count: number; gross_amount: number; commission_amount: number; net_amount: number; pending_amount: number; paid_amount: number; adjustments_amount: number };

export default async function GananciasPage() {
  const user = await requireRole("professional");
  const supabase = await createClient();
  const [{ data: s }, { data: payouts }] = await Promise.all([
    supabase.rpc("professional_earnings_summary"),
    supabase.from("professional_payouts").select("*, items:payout_items(appointment_id, gross_amount, commission_amount, net_amount)").eq("professional_id", user.id).order("created_at", { ascending: false }),
  ]);
  const sum = (s as Summary) ?? ({} as Summary);
  return (
    <>
      <PageHeader title="Ganancias y liquidaciones" subtitle="Médico en Casa Palmira recibe el pago del paciente y te transfiere el valor neto después de verificar el servicio." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Consultas realizadas" value={sum.completed_count ?? 0} />
        <Stat label="Valor bruto de servicios" value={formatCOP(sum.gross_amount)} />
        <Stat label="Comisiones descontadas" value={formatCOP(sum.commission_amount)} tone="amber" />
        <Stat label="Ganancias netas" value={formatCOP(sum.net_amount)} tone="green" />
        <Stat label="Pendiente de pago" value={formatCOP(sum.pending_amount)} tone="amber" hint="Servicios completados aún no transferidos" />
        <Stat label="Pagos recibidos" value={formatCOP(sum.paid_amount)} tone="green" />
        <Stat label="Ajustes" value={formatCOP(sum.adjustments_amount)} />
      </div>
      <h2 className="mb-3 mt-8 font-display text-xl font-bold">Historial de liquidaciones</h2>
      <Card>
        <Table head={["Periodo", "Servicios", "Bruto", "Comisión", "Ajustes", "Neto", "Estado", "Transferencia"]} empty={!payouts?.length}>
          {payouts?.map((p) => (
            <tr key={p.id}>
              <Td>{formatDate(p.period_start, { dateStyle: "medium" })} – {formatDate(p.period_end, { dateStyle: "medium" })}</Td>
              <Td>{p.items_count}</Td>
              <Td>{formatCOP(p.gross_amount)}</Td>
              <Td>−{formatCOP(p.commission_amount)}</Td>
              <Td>{formatCOP(p.adjustments_amount)}{p.adjustments_notes ? <span className="block text-xs text-ink-soft">{p.adjustments_notes}</span> : null}</Td>
              <Td className="font-semibold">{formatCOP(p.net_amount)}</Td>
              <Td><StatusBadge map={PAYOUT_STATUS} value={p.status} /></Td>
              <Td>{p.status === "paid" ? <><span className="font-mono text-xs">{p.transfer_reference}</span><span className="block text-xs text-ink-soft">{formatDateTime(p.paid_at)}</span></> : "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
