import { notFound } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPublicSettings } from "@/lib/data";
import { formatCOP, formatDateTime } from "@/lib/format";
import { CARE_TYPE } from "@/lib/status";

export default async function ComprobantePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireRole("patient");
  const supabase = await createClient();
  const { data: p } = await supabase.from("payments").select("*").eq("id", id).eq("patient_id", user.id).eq("status", "approved").maybeSingle();
  if (!p) notFound();
  const { data: a } = p.appointment_id ? await supabase.from("appointments").select("code, starts_at, care_type, duration_min, price_breakdown, specialty:specialties(name)").eq("id", p.appointment_id).single() : { data: null };
  const settings = await getPublicSettings();
  const legal = (settings.legal_entity ?? {}) as { name?: string; nit?: string; address?: string };
  const lines = (a?.price_breakdown?.lines ?? []) as { label: string; amount: number }[];
  const spec = (Array.isArray(a?.specialty) ? a?.specialty[0] : a?.specialty) as { name: string } | undefined;
  return (
    <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 print:border-0">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3"><LogoMark className="h-10 w-10" /><div><p className="font-display font-extrabold">MÉDICO EN CASA PALMIRA</p><p className="text-xs text-ink-soft">{legal.name || "Razón social pendiente"}{legal.nit ? ` · NIT ${legal.nit}` : ""}</p></div></div>
        <PrintButton />
      </div>
      <h1 className="mt-8 font-display text-2xl font-bold">Comprobante de pago</h1>
      <p className="text-sm text-ink-soft">Este documento no es una factura electrónica. La facturación se emite conforme a la normativa de la DIAN.</p>
      <dl className="mt-6 grid grid-cols-2 gap-4 text-sm">
        <div><dt className="text-ink-soft">Referencia</dt><dd className="font-mono">{p.reference}</dd></div>
        <div><dt className="text-ink-soft">Transacción pasarela</dt><dd className="font-mono">{p.provider_transaction_id ?? "—"}</dd></div>
        <div><dt className="text-ink-soft">Fecha de aprobación</dt><dd>{formatDateTime(p.approved_at)}</dd></div>
        <div><dt className="text-ink-soft">Medio de pago</dt><dd>{p.payment_method_type ?? "—"}</dd></div>
        <div><dt className="text-ink-soft">Pagador</dt><dd>{user.full_name}</dd></div>
        <div><dt className="text-ink-soft">Concepto</dt><dd>{p.purpose === "membership" ? "Membresía" : `Consulta ${a?.code} · ${spec?.name ?? ""} · ${CARE_TYPE[a?.care_type ?? "scheduled"]}`}</dd></div>
        {a && <div className="col-span-2"><dt className="text-ink-soft">Fecha del servicio</dt><dd>{formatDateTime(a.starts_at)} ({a.duration_min} min)</dd></div>}
      </dl>
      {lines.length > 0 && (
        <dl className="mt-6 divide-y divide-slate-100 border-t border-slate-200">
          {lines.map((l, i) => <div key={i} className="flex justify-between py-2 text-sm"><dt>{l.label}</dt><dd>{formatCOP(l.amount)}</dd></div>)}
        </dl>
      )}
      <div className="mt-4 flex justify-between border-t-2 border-ink pt-3 font-display text-lg font-bold"><span>Total pagado</span><span>{formatCOP(p.amount)}</span></div>
    </div>
  );
}
