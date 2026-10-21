import Link from "next/link";
import { DateFilters } from "@/components/DateFilters";
import { Card, PageHeader, Table, Td, buttonClass } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { addDays, bogotaDate, formatCOP } from "@/lib/format";

const ACCOUNTS: Record<string, { label: string; kind: "asset" | "liability" | "revenue" | "expense" }> = {
  cash_gateway: { label: "Efectivo y saldos en pasarela/banco", kind: "asset" },
  customer_funds_held: { label: "Fondos de pacientes (consultas no prestadas)", kind: "liability" },
  professional_payable: { label: "Por pagar a profesionales", kind: "liability" },
  refunds_payable: { label: "Reembolsos por pagar", kind: "liability" },
  platform_commission_revenue: { label: "Ingreso: comisiones", kind: "revenue" },
  platform_service_fee_revenue: { label: "Ingreso: cargos de servicio", kind: "revenue" },
  platform_membership_revenue: { label: "Ingreso: membresías", kind: "revenue" },
  platform_cancellation_revenue: { label: "Ingreso: penalidades por cancelación", kind: "revenue" },
  promotional_discount_expense: { label: "Gasto: descuentos asumidos", kind: "expense" },
  gateway_fee_expense: { label: "Gasto: comisiones de pasarela", kind: "expense" },
  payout_adjustments: { label: "Ajustes a liquidaciones", kind: "expense" },
};

export default async function AdminReportes({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const to = sp.hasta || bogotaDate();
  const from = sp.desde || addDays(to, -29);
  const supabase = await createClient();
  const { data: ledger } = await supabase.from("financial_ledger").select("account, direction, amount")
    .gte("occurred_at", `${from}T00:00:00-05:00`).lte("occurred_at", `${to}T23:59:59-05:00`).limit(50000);
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const l of ledger ?? []) {
    const t = totals.get(l.account) ?? { debit: 0, credit: 0 };
    t[l.direction as "debit" | "credit"] += Number(l.amount);
    totals.set(l.account, t);
  }
  const net = (k: string) => { const t = totals.get(k) ?? { debit: 0, credit: 0 }; const kind = ACCOUNTS[k].kind; return kind === "asset" || kind === "expense" ? t.debit - t.credit : t.credit - t.debit; };
  const revenue = ["platform_commission_revenue", "platform_service_fee_revenue", "platform_membership_revenue", "platform_cancellation_revenue"].reduce((s, k) => s + net(k), 0);
  const expenses = ["promotional_discount_expense", "gateway_fee_expense", "payout_adjustments"].reduce((s, k) => s + net(k), 0);
  const q = `desde=${from}&hasta=${to}`;
  return (
    <>
      <PageHeader title="Reportes financieros" subtitle="Basado en el libro contable de partida doble. El recaudo NO es utilidad." />
      <DateFilters from={from} to={to} />
      <div className="mb-6 flex flex-wrap gap-2">
        {[["citas", "Citas"], ["pagos", "Pagos"], ["reembolsos", "Reembolsos"], ["liquidaciones", "Liquidaciones"], ["libro", "Libro contable"], ["membresias", "Membresías"]].map(([k, l]) => (
          <Link key={k} href={`/admin/reportes/exportar?tipo=${k}&${q}`} className={buttonClass({ variant: "outline", size: "sm" })} prefetch={false}>Exportar {l} (CSV)</Link>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold">Estado de resultados (periodo)</h2>
          <dl className="mt-3 divide-y divide-slate-100 text-sm">
            {Object.entries(ACCOUNTS).filter(([, a]) => a.kind === "revenue" || a.kind === "expense").map(([k, a]) => (
              <div key={k} className="flex justify-between py-2"><dt>{a.label}</dt><dd className={a.kind === "expense" ? "text-red-700" : ""}>{a.kind === "expense" ? "−" : ""}{formatCOP(net(k))}</dd></div>
            ))}
            <div className="flex justify-between py-2 font-bold"><dt>Ingresos netos de la plataforma</dt><dd>{formatCOP(revenue - expenses)}</dd></div>
          </dl>
          <p className="mt-2 text-xs text-ink-soft">Antes de impuestos, nómina y demás gastos operativos no registrados en la plataforma.</p>
        </Card>
        <Card>
          <h2 className="font-display text-lg font-bold">Movimientos por cuenta (periodo)</h2>
          <Table head={["Cuenta", "Débitos", "Créditos"]}>
            {Object.entries(ACCOUNTS).map(([k, a]) => (
              <tr key={k}><Td>{a.label}</Td><Td>{formatCOP(totals.get(k)?.debit ?? 0)}</Td><Td>{formatCOP(totals.get(k)?.credit ?? 0)}</Td></tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
