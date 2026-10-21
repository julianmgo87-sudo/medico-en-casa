import Link from "next/link";
import { Card, PageHeader, StatusBadge, Table, Td } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCOP, formatDateTime } from "@/lib/format";
import { PAYMENT_STATUS, REFUND_STATUS } from "@/lib/status";

export default async function PagosPage() {
  const user = await requireRole("patient");
  const supabase = await createClient();
  const [{ data: payments }, { data: refunds }] = await Promise.all([
    supabase.from("payments").select("id, reference, purpose, status, amount, payment_method_type, created_at, approved_at, appointment_id").eq("patient_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("refunds").select("id, amount, status, reason, provider_reference, requested_at, processed_at, appointment_id").order("requested_at", { ascending: false }),
  ]);
  return (
    <>
      <PageHeader title="Pagos y comprobantes" />
      <Card>
        <Table head={["Fecha", "Concepto", "Referencia", "Medio", "Valor", "Estado", ""]} empty={!payments?.length}>
          {payments?.map((p) => (
            <tr key={p.id}>
              <Td>{formatDateTime(p.created_at)}</Td>
              <Td>{p.purpose === "membership" ? "Membresía" : <Link href={`/paciente/citas/${p.appointment_id}`} className="text-brand-700 hover:underline">Consulta</Link>}</Td>
              <Td className="font-mono text-xs">{p.reference}</Td>
              <Td>{p.payment_method_type ?? "—"}</Td>
              <Td className="font-semibold">{formatCOP(p.amount)}</Td>
              <Td><StatusBadge map={PAYMENT_STATUS} value={p.status} /></Td>
              <Td>{p.status === "approved" && <Link href={`/paciente/comprobante/${p.id}`} className="text-sm font-semibold text-brand-700">Comprobante</Link>}</Td>
            </tr>
          ))}
        </Table>
      </Card>
      <h2 className="mb-3 mt-8 font-display text-xl font-bold">Devoluciones</h2>
      <Card>
        <Table head={["Solicitada", "Motivo", "Valor", "Estado", "Comprobante"]} empty={!refunds?.length}>
          {refunds?.map((r) => (
            <tr key={r.id}><Td>{formatDateTime(r.requested_at)}</Td><Td>{r.reason}</Td><Td>{formatCOP(r.amount)}</Td><Td><StatusBadge map={REFUND_STATUS} value={r.status} /></Td><Td className="font-mono text-xs">{r.provider_reference ?? "—"}</Td></tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
