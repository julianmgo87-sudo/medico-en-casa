import { Back, Card, Field, Flash, Input, PageHeader, Select, StatusBadge, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { formatCOP, formatDate } from "@/lib/format";
import { MEMBERSHIP_STATUS } from "@/lib/status";
import { savePlan, setMembershipStatus } from "@/app/actions/admin";

const SOURCES: Record<string, string> = { purchase: "Compra", admin_grant: "Cortesía admin", promotion: "Promoción" };

export default async function AdminMembresias({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: plans }, { data: mems }, { data: settings }] = await Promise.all([
    supabase.from("membership_plans").select("*").order("sort_order"),
    supabase.from("patient_memberships").select("*, patient:users!patient_memberships_patient_id_fkey(full_name, email), plan:membership_plans(name)").neq("status", "pending_payment").order("created_at", { ascending: false }).limit(200),
    supabase.from("application_settings").select("value").eq("key", "membership_required").maybeSingle(),
  ]);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] : v);
  const back = "/admin/membresias";
  return (
    <>
      <PageHeader title="Gestión de membresías" subtitle={`Membresía obligatoria para reservar: ${settings?.value === false ? "NO" : "SÍ"} (se cambia en Configuración).`} />
      <Flash searchParams={sp} />
      <div className="grid gap-4 lg:grid-cols-2">
        {[...(plans ?? []), null].map((p, i) => (
          <Card key={p?.id ?? `new-${i}`}>
            <h2 className="font-display text-lg font-bold">{p ? p.name : "Nuevo plan / promoción"}</h2>
            <form action={savePlan} className="mt-3 grid gap-3 sm:grid-cols-2"><Back to={back} />{p && <input type="hidden" name="id" value={p.id} />}
              <Field label="Código"><Input name="code" defaultValue={p?.code} required /></Field>
              <Field label="Nombre"><Input name="name" defaultValue={p?.name} required /></Field>
              <Field label="Descripción" className="sm:col-span-2"><Input name="description" defaultValue={p?.description} /></Field>
              <Field label="Periodo"><Select name="period_type" defaultValue={p?.period_type ?? "monthly"}><option value="monthly">Mensual</option><option value="annual">Anual</option><option value="custom">Periodo determinado</option></Select></Field>
              <Field label="Duración (días)"><Input name="duration_days" type="number" defaultValue={p?.duration_days ?? 30} required /></Field>
              <Field label="Precio (COP)" hint="0 = periodo gratuito / promoción"><Input name="price" inputMode="numeric" defaultValue={p?.price ?? ""} required /></Field>
              <Field label="Orden"><Input name="sort_order" type="number" defaultValue={p?.sort_order ?? 0} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={p?.is_active ?? true} /> Activo</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_promotional" defaultChecked={p?.is_promotional ?? false} /> Promocional</label>
              <div className="sm:col-span-2"><SubmitButton variant="outline">{p ? `Guardar (actual ${formatCOP(p.price)})` : "Crear plan"}</SubmitButton></div>
            </form>
          </Card>
        ))}
      </div>
      <h2 className="mb-3 mt-8 font-display text-xl font-bold">Membresías de pacientes</h2>
      <Card>
        <Table head={["Paciente", "Plan", "Origen", "Vigencia", "Pagado", "Estado", ""]} empty={!mems?.length}>
          {mems?.map((m) => (
            <tr key={m.id}>
              <Td>{one(m.patient)?.full_name}<span className="block text-xs text-ink-soft">{one(m.patient)?.email}</span></Td>
              <Td>{one(m.plan)?.name ?? "Cortesía"}</Td><Td>{SOURCES[m.source]}{m.notes && <span className="block text-xs text-ink-soft">{m.notes}</span>}</Td>
              <Td className="text-xs">{formatDate(m.starts_at, { dateStyle: "medium" })} → {formatDate(m.ends_at, { dateStyle: "medium" })}</Td>
              <Td>{formatCOP(m.price_paid)}</Td>
              <Td><StatusBadge map={MEMBERSHIP_STATUS} value={m.status} /></Td>
              <Td>{["active", "suspended"].includes(m.status) && (
                <form action={setMembershipStatus} className="flex gap-1"><Back to={back} /><input type="hidden" name="membership_id" value={m.id} />
                  <Select name="status" defaultValue={m.status} className="!py-1 text-xs"><option value="active">Activa</option><option value="suspended">Suspender</option><option value="cancelled">Cancelar</option></Select>
                  <SubmitButton size="sm" variant="ghost">OK</SubmitButton></form>
              )}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
