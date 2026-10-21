import Link from "next/link";
import { BarChart } from "@/components/BarChart";
import { DateFilters } from "@/components/DateFilters";
import { Card, Field, Notice, PageHeader, Select, Stat } from "@/components/ui";
import { NotificationsCard } from "@/components/Notifications";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, bogotaDate, formatCOP } from "@/lib/format";
import { integrationStatus } from "@/lib/env";

type Stats = {
  counts: Record<string, number>;
  period: Record<string, number>;
  money: Record<string, number>;
  rates: { acceptance_rate: number | null; cancellation_rate: number | null };
  bookings_by_day: { day: string; count: number }[];
  income_by_month: { month: string; platform_income: number; collected: number }[];
  top_services: { name: string; count: number }[];
  top_professionals: { name: string; count: number }[];
};

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const to = sp.hasta || bogotaDate();
  const from = sp.desde || addDays(to, -29);
  const supabase = await createClient();
  const [{ data, error }, { data: pros }, { data: cats }] = await Promise.all([
    supabase.rpc("admin_dashboard_stats", { p_from: from, p_to: to, p_professional: sp.profesional || null, p_category: sp.servicio || null }),
    supabase.from("public_professionals").select("id, full_name").order("full_name"),
    supabase.from("service_categories").select("id, name").order("sort_order"),
  ]);
  const s = data as Stats | null;
  const me = await getCurrentUser();
  const integ = integrationStatus();
  if (error || !s) return <Notice kind="error">No se pudieron cargar las estadísticas.</Notice>;
  const m = s.money;
  // Series completas: días/meses sin datos se muestran en cero.
  const days: { label: string; value: number }[] = [];
  for (let d = from; d <= to && days.length < 370; d = addDays(d, 1)) days.push({ label: d.slice(5), value: Number(s.bookings_by_day.find((x) => x.day === d)?.count ?? 0) });
  const months: { label: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const base = new Date(to + "T12:00:00-05:00");
    const m = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 15)).toISOString().slice(0, 7);
    months.push({ label: m, value: Number(s.income_by_month.find((x) => x.month === m)?.platform_income ?? 0) });
  }
  const neg = (v: number) => (Number(v) ? `−${formatCOP(v)}` : formatCOP(0));
  const pct = (v: number | null) => (v === null || v === undefined ? "—" : `${v} %`);

  return (
    <>
      <PageHeader title="Panel de administración" subtitle="Indicadores operativos y financieros." />
      {(!integ.wompi || !integ.email) && (
        <Notice kind="warning" className="mb-6" title="Integraciones pendientes">
          {!integ.wompi && <p>Pasarela de pagos Wompi: <strong>no configurada</strong> (no se pueden recibir pagos).</p>}
          {!integ.email && <p>Correo transaccional: <strong>no configurado</strong> (las notificaciones quedan en cola y solo se ven dentro de la app).</p>}
          <Link href="/admin/configuracion" className="font-semibold underline">Ver estado de integraciones</Link>
        </Notice>
      )}
      <DateFilters from={from} to={to} extra={<>
        <Field label="Profesional"><Select name="profesional" defaultValue={sp.profesional ?? ""}><option value="">Todos</option>{pros?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select></Field>
        <Field label="Servicio"><Select name="servicio" defaultValue={sp.servicio ?? ""}><option value="">Todos</option>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      </>} />

      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-soft">Operación</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Pacientes registrados" value={s.counts.patients} />
        <Stat label="Membresías activas" value={s.counts.active_memberships} tone="green" />
        <Stat label="Profesionales aprobados" value={s.counts.approved_professionals} hint={`${s.counts.professionals_pending_review} en revisión`} />
        <Stat label="Solicitudes pendientes" value={s.counts.pending_requests} tone={s.counts.pending_requests ? "amber" : "blue"} hint="Aceptación o reasignación" />
        <Stat label="Citas confirmadas (periodo)" value={s.period.confirmed} />
        <Stat label="Citas rechazadas (periodo)" value={s.period.rejected} tone="red" />
        <Stat label="Citas completadas (periodo)" value={s.period.completed} tone="green" />
        <Stat label="Citas canceladas (periodo)" value={s.period.cancelled} />
        <Stat label="Tasa de aceptación" value={pct(s.rates.acceptance_rate)} />
        <Stat label="Tasa de cancelación" value={pct(s.rates.cancellation_rate)} />
        <Stat label="Reembolsos pendientes" value={s.counts.refunds_pending} tone={s.counts.refunds_pending ? "amber" : "blue"} hint={formatCOP(m.refunds_pending)} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-ink-soft">Dinero recaudado (no es utilidad)</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Recaudo total" value={formatCOP(m.collected_total)} hint="Membresías + consultas cobradas" />
        <Stat label="Recaudo de consultas" value={formatCOP(m.collected_appointments)} />
        <Stat label="Fondos de pacientes en custodia" value={formatCOP(m.customer_funds_held_balance)} hint="Consultas pagadas aún no prestadas" tone="amber" />
        <Stat label="Por pagar a profesionales" value={formatCOP(m.professional_payable_balance)} hint="Servicios prestados no transferidos" tone="amber" />
        <Stat label="Liquidaciones pendientes" value={formatCOP(m.payouts_pending)} />
        <Stat label="Liquidaciones pagadas (periodo)" value={formatCOP(m.payouts_paid)} />
        <Stat label="Reembolsos realizados (periodo)" value={formatCOP(m.refunds_completed)} />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-bold uppercase tracking-wide text-ink-soft">Ingresos propios de la plataforma (periodo)</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ingresos por membresías" value={formatCOP(m.membership_revenue)} />
        <Stat label="Comisiones de la plataforma" value={formatCOP(m.commission_revenue)} />
        <Stat label="Cargos de servicio" value={formatCOP(m.service_fee_revenue)} />
        <Stat label="Penalidades por cancelación" value={formatCOP(m.cancellation_revenue)} />
        <Stat label="Descuentos asumidos" value={neg(m.discount_expense)} />
        <Stat label="Costos de pasarela" value={neg(m.gateway_fees)} hint="Según conciliación registrada" />
        <Stat label="Ingresos estimados de la plataforma" value={formatCOP(m.platform_estimated_income)} tone="green" hint="Antes de impuestos y gastos operativos" />
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        <BarChart title="Reservas pagadas por día" data={days} />
        <BarChart title="Ingresos estimados de la plataforma por mes (COP)" data={months} format={formatCOP} />
        <BarChart horizontal title="Servicios más solicitados" data={s.top_services.map((d) => ({ label: d.name, value: d.count }))} />
        <BarChart horizontal title="Profesionales con más citas" data={s.top_professionals.map((d) => ({ label: d.name, value: d.count }))} />
      </div>
      <Card className="mt-6 text-sm text-ink-soft">
        El recaudo incluye dinero de pacientes que pertenece a los profesionales o que puede devolverse. Los ingresos propios provienen del libro contable (comisiones, cargos, membresías y penalidades) menos descuentos y costos de pasarela.
        <Link href={`/admin/reportes?desde=${from}&hasta=${to}`} className="ml-1 font-semibold text-brand-700">Ver reporte financiero y exportar CSV →</Link>
      </Card>
      {me && <div className="mt-6"><NotificationsCard userId={me.id} back="/admin" /></div>}
    </>
  );
}
