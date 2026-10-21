import { Back, Card, Field, Flash, Input, Notice, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { ScopeFields } from "@/components/ScopeFields";
import { createClient } from "@/lib/supabase/server";
import { getReferenceLists, targetName } from "@/lib/admin-data";
import { formatDate } from "@/lib/format";
import { SCOPES } from "@/lib/status";
import { saveCommission, saveSettings, toggleRow } from "@/app/actions/admin";

const BASES: Record<string, string> = {
  service_amount: "Valor del servicio (tarifa base + recargos) — recomendado",
  base_only: "Solo tarifa base (sin recargos)",
  service_and_travel: "Valor del servicio + desplazamiento",
};

export default async function AdminComisiones({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const lists = await getReferenceLists();
  const [{ data: rows }, { data: base }] = await Promise.all([
    supabase.from("commissions").select("*").order("is_active", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("application_settings").select("value").eq("key", "commission_base").maybeSingle(),
  ]);
  const back = "/admin/comisiones";
  return (
    <>
      <PageHeader title="Gestión de comisiones" subtitle="La comisión se congela en cada reserva al momento de crearla; los cambios no son retroactivos." />
      <Flash searchParams={sp} />
      <Card className="mb-6">
        <h2 className="font-display text-lg font-bold">Base de cálculo</h2>
        <form action={saveSettings} className="mt-3 flex flex-wrap items-end gap-3"><Back to={back} />
          <Field label="La comisión se calcula sobre"><Select name="s_commission_base" defaultValue={String(base?.value ?? "service_amount")}>{Object.entries(BASES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <SubmitButton variant="outline">Guardar</SubmitButton>
        </form>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-ink-soft">
          <li><strong>Desplazamiento:</strong> se paga al profesional (no lleva comisión salvo que elijas la base “servicio + desplazamiento”).</li>
          <li><strong>Cargo de servicio:</strong> es 100 % ingreso de la plataforma y no se liquida al profesional.</li>
          <li><strong>Descuentos y promociones:</strong> los asume la plataforma; no reducen la liquidación del profesional.</li>
          <li><strong>Comisión de la pasarela:</strong> es gasto de la plataforma; no se descuenta al profesional.</li>
          <li><strong>Impuestos:</strong> los servicios de salud suelen estar excluidos de IVA; la comisión y la membresía pueden estar gravadas. Validar con contador.</li>
        </ul>
        <p className="mt-3 text-sm">Ejemplo: consulta $120.000 con comisión 20 % → plataforma $24.000, profesional $96.000.</p>
      </Card>
      <Notice kind="info" className="mb-4">Prioridad: profesional → especialidad → categoría → tipo de atención → general. Si no hay ninguna activa se usa 20 %.</Notice>
      <Card>
        <Table head={["Nombre", "Alcance", "Porcentaje", "Creada", ""]} empty={!rows?.length}>
          {rows?.map((c) => (
            <tr key={c.id} className={c.is_active ? "" : "opacity-50"}>
              <Td className="font-semibold">{c.name}</Td><Td>{SCOPES[c.scope]}: {targetName(c, lists)}</Td><Td>{Number(c.percent)} %</Td><Td>{formatDate(c.created_at, { dateStyle: "medium" })}</Td>
              <Td><form action={toggleRow}><Back to={back} /><input type="hidden" name="table" value="commissions" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="value" value={c.is_active ? "0" : "1"} /><button className="text-xs font-semibold text-brand-700">{c.is_active ? "Desactivar" : "Activar"}</button></form></Td>
            </tr>
          ))}
        </Table>
        <form action={saveCommission} className="mt-6 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-3"><Back to={back} />
          <Field label="Nombre"><Input name="name" required placeholder="Comisión fisioterapia" /></Field>
          <Field label="Porcentaje"><Input name="percent" required inputMode="decimal" /></Field>
          <ScopeFields {...lists} withCareType />
          <div className="flex items-end"><SubmitButton>Guardar comisión</SubmitButton></div>
        </form>
      </Card>
    </>
  );
}
