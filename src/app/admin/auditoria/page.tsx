import { Button, Card, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

function diff(oldD: Record<string, unknown> | null, newD: Record<string, unknown> | null) {
  if (!oldD || !newD) return null;
  return Object.keys(newD).filter((k) => k !== "updated_at" && JSON.stringify(oldD[k]) !== JSON.stringify(newD[k])).map((k) => `${k}: ${JSON.stringify(oldD[k])} → ${JSON.stringify(newD[k])}`);
}

export default async function AdminAuditoria({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(200);
  if (sp.entidad) q = q.eq("entity_type", sp.entidad);
  if (sp.id) q = q.eq("entity_id", sp.id);
  const { data } = await q;
  const ENT = ["users", "professional_profiles", "professional_credentials", "professional_payout_accounts", "pricing_rules", "commissions", "membership_plans", "patient_memberships", "refunds", "professional_payouts", "application_settings", "service_categories", "specialties", "service_areas", "holidays", "payments", "appointments"];
  return (
    <>
      <PageHeader title="Historial de auditoría" subtitle="Registro inmutable de cambios administrativos y financieros importantes." />
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <Select name="entidad" defaultValue={sp.entidad ?? ""} className="max-w-xs"><option value="">Todas las entidades</option>{ENT.map((e) => <option key={e}>{e}</option>)}</Select>
        <Input name="id" defaultValue={sp.id} placeholder="ID de registro" className="max-w-xs" />
        <Button variant="outline">Filtrar</Button>
      </form>
      <Card>
        <Table head={["Fecha", "Actor", "Acción", "Entidad", "Cambios"]} empty={!data?.length}>
          {data?.map((l) => {
            const d = diff(l.old_data, l.new_data);
            return (
              <tr key={l.id}>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(l.created_at)}</Td>
                <Td className="text-xs">{l.actor_role}{l.actor_id ? <span className="block font-mono text-ink-faint">{l.actor_id.slice(0, 8)}</span> : null}</Td>
                <Td>{l.action}</Td>
                <Td className="text-xs">{l.entity_type}<span className="block font-mono text-ink-faint">{l.entity_id?.slice(0, 13)}</span></Td>
                <Td className="max-w-md text-xs text-ink-soft">{d ? (d.length ? d.slice(0, 6).map((x) => <p key={x} className="truncate">{x}</p>) : "—") : <span className="line-clamp-2 break-all">{JSON.stringify(l.new_data ?? l.old_data)}</span>}</Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
