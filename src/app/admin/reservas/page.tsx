import Link from "next/link";
import { DateFilters } from "@/components/DateFilters";
import { Card, Field, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { addDays, bogotaDate, formatCOP, formatDateTime } from "@/lib/format";
import { APPOINTMENT_STATUS, CARE_TYPE, PAYMENT_STATE } from "@/lib/status";

export default async function AdminReservas({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const to = sp.hasta || addDays(bogotaDate(), 30);
  const from = sp.desde || addDays(bogotaDate(), -30);
  const supabase = await createClient();
  let q = supabase.from("appointments")
    .select("id, code, status, payment_state, care_type, starts_at, total_amount, response_deadline, patient:users!appointments_patient_id_fkey(full_name), pro:professional_profiles!appointments_professional_id_fkey(user:users!professional_profiles_user_id_fkey(full_name)), specialty:specialties(name)")
    .gte("starts_at", `${from}T00:00:00-05:00`).lte("starts_at", `${to}T23:59:59-05:00`).order("starts_at", { ascending: false }).limit(300);
  if (sp.estado) q = q.eq("status", sp.estado);
  if (sp.profesional) q = q.eq("professional_id", sp.profesional);
  const [{ data }, { data: pros }] = await Promise.all([q, supabase.from("public_professionals").select("id, full_name").order("full_name")]);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] : v);
  return (
    <>
      <PageHeader title="Gestión de reservas" />
      <DateFilters from={from} to={to} extra={<>
        <Field label="Estado"><Select name="estado" defaultValue={sp.estado ?? ""}><option value="">Todos</option>{Object.entries(APPOINTMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
        <Field label="Profesional"><Select name="profesional" defaultValue={sp.profesional ?? ""}><option value="">Todos</option>{pros?.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</Select></Field>
      </>} />
      <Card>
        <Table head={["Cita", "Fecha", "Paciente", "Profesional", "Tipo", "Valor", "Pago", "Estado"]} empty={!data?.length}>
          {data?.map((a) => (
            <tr key={a.id}>
              <Td><Link href={`/admin/reservas/${a.id}`} className="font-mono font-semibold text-brand-700">{a.code}</Link><p className="text-xs text-ink-soft">{one(a.specialty)?.name}</p></Td>
              <Td>{formatDateTime(a.starts_at)}</Td>
              <Td>{one(a.patient)?.full_name}</Td>
              <Td>{one(one(a.pro)?.user ?? null)?.full_name}</Td>
              <Td>{CARE_TYPE[a.care_type]}</Td>
              <Td>{formatCOP(a.total_amount)}</Td>
              <Td className="text-xs">{PAYMENT_STATE[a.payment_state]}</Td>
              <Td><StatusBadge map={APPOINTMENT_STATUS} value={a.status} /></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
