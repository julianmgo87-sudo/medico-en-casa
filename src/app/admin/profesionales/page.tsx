import Link from "next/link";
import { Button, Card, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatCOP, formatDateTime } from "@/lib/format";
import { PROFESSIONAL_STATUS } from "@/lib/status";

export default async function AdminProfesionales({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("professional_profiles")
    .select("user_id, status, profession, proposed_hourly_rate, approved_hourly_rate, submitted_at, rethus_verified_at, user:users!professional_profiles_user_id_fkey(full_name, email, status), specialty:specialties(name)")
    .order("submitted_at", { ascending: false, nullsFirst: false });
  const estado = sp.estado ?? "pending_review";
  if (estado !== "all") q = q.eq("status", estado);
  const { data } = await q;
  return (
    <>
      <PageHeader title="Verificación de profesionales" subtitle="Ningún profesional recibe solicitudes hasta ser aprobado." />
      <form className="mb-4 flex gap-2" method="get">
        <Select name="estado" defaultValue={estado} className="max-w-xs">
          <option value="all">Todos</option>
          {Object.entries(PROFESSIONAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Button variant="outline">Filtrar</Button>
      </form>
      <Card>
        <Table head={["Profesional", "Especialidad", "Tarifa propuesta", "Tarifa aprobada", "RETHUS", "Enviado", "Estado", ""]} empty={!data?.length}>
          {data?.map((p) => {
            const u = (Array.isArray(p.user) ? p.user[0] : p.user) as { full_name: string; email: string } | null;
            const s = (Array.isArray(p.specialty) ? p.specialty[0] : p.specialty) as { name: string } | null;
            return (
              <tr key={p.user_id}>
                <Td><p className="font-semibold">{u?.full_name || "(sin nombre)"}</p><p className="text-xs text-ink-soft">{u?.email}</p></Td>
                <Td>{s?.name ?? "—"}<p className="text-xs text-ink-soft">{p.profession}</p></Td>
                <Td>{p.proposed_hourly_rate ? formatCOP(p.proposed_hourly_rate) : "—"}</Td>
                <Td>{p.approved_hourly_rate ? formatCOP(p.approved_hourly_rate) : "—"}</Td>
                <Td>{p.rethus_verified_at ? "Verificado" : "Pendiente"}</Td>
                <Td>{formatDateTime(p.submitted_at)}</Td>
                <Td><StatusBadge map={PROFESSIONAL_STATUS} value={p.status} /></Td>
                <Td><Link href={`/admin/profesionales/${p.user_id}`} className="font-semibold text-brand-700">Revisar</Link></Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
