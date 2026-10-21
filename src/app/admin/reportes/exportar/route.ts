import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";

function csvCell(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  // Evita inyección de fórmulas en hojas de cálculo.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const EXPORTS: Record<string, { table: string; select: string; dateCol: string }> = {
  citas: { table: "appointments", select: "code, status, payment_state, care_type, starts_at, duration_min, base_amount, surcharges_amount, travel_fee, service_fee, discount_amount, total_amount, commission_percent, commission_amount, professional_net_amount, amount_paid, amount_refunded, created_at, completed_at", dateCol: "created_at" },
  pagos: { table: "payments", select: "reference, purpose, status, amount, currency, payment_method_type, provider_transaction_id, provider_fee, approved_at, reconciled_at, created_at", dateCol: "created_at" },
  reembolsos: { table: "refunds", select: "id, amount, status, reason, method, provider_reference, requested_at, processed_at", dateCol: "requested_at" },
  liquidaciones: { table: "professional_payouts", select: "id, professional_id, period_start, period_end, status, items_count, gross_amount, commission_amount, adjustments_amount, net_amount, transfer_method, transfer_reference, approved_at, paid_at", dateCol: "created_at" },
  libro: { table: "financial_ledger", select: "id, entry_group, occurred_at, account, direction, amount, description, appointment_id, payment_id, refund_id, payout_id, membership_id", dateCol: "occurred_at" },
  membresias: { table: "patient_memberships", select: "id, patient_id, status, source, price_paid, starts_at, ends_at, created_at", dateCol: "created_at" },
};

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return NextResponse.json({ error: "No autorizado" }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const cfg = EXPORTS[p.get("tipo") ?? ""];
  if (!cfg) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  const from = p.get("desde") ?? "2000-01-01";
  const to = p.get("hasta") ?? "2100-01-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return NextResponse.json({ error: "Fechas inválidas" }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.from(cfg.table).select(cfg.select)
    .gte(cfg.dateCol, `${from}T00:00:00-05:00`).lte(cfg.dateCol, `${to}T23:59:59-05:00`).order(cfg.dateCol).limit(50000);
  if (error) return NextResponse.json({ error: "No se pudo generar el reporte" }, { status: 500 });
  const cols = cfg.select.split(",").map((c) => c.trim());
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const csv = "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${p.get("tipo")}_${from}_${to}.csv"`, "Cache-Control": "no-store" },
  });
}
