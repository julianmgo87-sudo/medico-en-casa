import { Back, Card, Field, Flash, Input, Notice, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { ScopeFields } from "@/components/ScopeFields";
import { createClient } from "@/lib/supabase/server";
import { getReferenceLists, targetName } from "@/lib/admin-data";
import { formatCOP, formatDate } from "@/lib/format";
import { PRICING_RULE_TYPES, SCOPES } from "@/lib/status";
import { saveHoliday, savePricingRule, saveSettings, saveSpecialtyRate, setProfessionalRate, toggleRow } from "@/app/actions/admin";

export default async function AdminPrecios({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const lists = await getReferenceLists();
  const [{ data: rules }, { data: pros }, { data: specs }, { data: holidays }, { data: settings }, { data: areas }] = await Promise.all([
    supabase.from("pricing_rules").select("*").order("is_active", { ascending: false }).order("rule_type"),
    supabase.from("professional_profiles").select("user_id, status, proposed_hourly_rate, approved_hourly_rate, user:users!professional_profiles_user_id_fkey(full_name), specialty:specialties(name)").in("status", ["approved", "pending_review"]),
    supabase.from("specialties").select("id, name, default_hourly_rate, default_duration_min").order("name"),
    supabase.from("holidays").select("*").gte("day", new Date().toISOString().slice(0, 10)).order("day"),
    supabase.from("application_settings").select("key, value").in("key", ["night_start", "night_end"]),
    supabase.from("service_areas").select("id, name, travel_fee").order("name"),
  ]);
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] : v);
  const back = "/admin/precios";
  const night = Object.fromEntries((settings ?? []).map((s) => [s.key, String(s.value)]));
  return (
    <>
      <PageHeader title="Gestión de precios" subtitle="Los cambios aplican solo a reservas nuevas. Cada reserva guarda su desglose definitivo." />
      <Flash searchParams={sp} />
      <Notice kind="info" className="mb-6">Precio = tarifa/hora aprobada × duración + recargos (% sobre la tarifa base) + desplazamiento de la zona + cargo de servicio − descuento. Festivo y fin de semana no se acumulan entre sí (aplica festivo); el nocturno sí se acumula. Para reglas del mismo tipo gana la más específica: profesional → especialidad → categoría → general.</Notice>

      <Card className="mb-6">
        <h2 className="font-display text-lg font-bold">Tarifas por profesional</h2>
        <Table head={["Profesional", "Especialidad", "Propuesta", "Tarifa final / hora"]} empty={!pros?.length}>
          {pros?.map((p) => (
            <tr key={p.user_id}>
              <Td>{one(p.user as never as { full_name: string }[])?.full_name}{p.status !== "approved" && <span className="ml-1 text-xs text-amber-700">(en revisión)</span>}</Td>
              <Td>{one(p.specialty as never as { name: string }[])?.name}</Td>
              <Td>{p.proposed_hourly_rate ? formatCOP(p.proposed_hourly_rate) : "—"}</Td>
              <Td><form action={setProfessionalRate} className="flex gap-2"><Back to={back} /><input type="hidden" name="professional_id" value={p.user_id} /><Input name="approved_hourly_rate" defaultValue={p.approved_hourly_rate ?? ""} className="w-32" inputMode="numeric" /><SubmitButton size="sm" variant="outline">Guardar</SubmitButton></form></Td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold">Tarifas de referencia por especialidad</h2>
          <p className="text-xs text-ink-soft">Referencia para aprobar profesionales; el paciente paga la tarifa final del profesional.</p>
          <ul className="mt-3 space-y-2">
            {specs?.map((s) => (
              <li key={s.id}><form action={saveSpecialtyRate} className="flex flex-wrap items-center gap-2 text-sm"><Back to={back} /><input type="hidden" name="id" value={s.id} />
                <span className="w-48 font-semibold">{s.name}</span><Input name="default_hourly_rate" defaultValue={s.default_hourly_rate ?? ""} className="w-28" inputMode="numeric" /><Input name="default_duration_min" type="number" defaultValue={s.default_duration_min} className="w-20" /><span className="text-xs">min</span><SubmitButton size="sm" variant="ghost">Guardar</SubmitButton></form></li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="font-display text-lg font-bold">Horario nocturno</h2>
          <form action={saveSettings} className="mt-3 flex items-end gap-3"><Back to={back} />
            <Field label="Inicio"><Input type="time" name="s_night_start" defaultValue={night.night_start} /></Field>
            <Field label="Fin"><Input type="time" name="s_night_end" defaultValue={night.night_end} /></Field>
            <SubmitButton size="sm" variant="outline">Guardar</SubmitButton>
          </form>
          <h3 className="mt-6 font-semibold">Costos de desplazamiento por zona</h3>
          <p className="text-xs text-ink-soft">Se editan en Configuración → Zonas de cobertura. Actuales: {areas?.slice(0, 6).map((a) => `${a.name} ${formatCOP(a.travel_fee)}`).join(" · ")}…</p>
        </Card>
      </div>

      <Card className="mb-6">
        <h2 className="font-display text-lg font-bold">Recargos, cargos y promociones</h2>
        <Table head={["Nombre", "Tipo", "Alcance", "Valor", "Código", "Vigencia", ""]} empty={!rules?.length}>
          {rules?.map((r) => (
            <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
              <Td className="font-semibold">{r.name}</Td><Td>{PRICING_RULE_TYPES[r.rule_type]}</Td>
              <Td>{SCOPES[r.scope]}: {targetName(r, lists)}</Td>
              <Td>{r.value_type === "percent" ? `${Number(r.value)} %` : formatCOP(r.value)}</Td>
              <Td className="font-mono text-xs">{r.promo_code ?? "—"}</Td>
              <Td className="text-xs">{r.valid_from ? formatDate(r.valid_from, { dateStyle: "short" }) : "—"} → {r.valid_until ? formatDate(r.valid_until, { dateStyle: "short" }) : "∞"}</Td>
              <Td><form action={toggleRow}><Back to={back} /><input type="hidden" name="table" value="pricing_rules" /><input type="hidden" name="id" value={r.id} /><input type="hidden" name="value" value={r.is_active ? "0" : "1"} /><button className="text-xs font-semibold text-brand-700">{r.is_active ? "Desactivar" : "Activar"}</button></form></Td>
            </tr>
          ))}
        </Table>
        <form action={savePricingRule} className="mt-6 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2 lg:grid-cols-4"><Back to={back} />
          <Field label="Nombre"><Input name="name" required placeholder="Recargo nocturno fisioterapia" /></Field>
          <Field label="Tipo"><Select name="rule_type">{Object.entries(PRICING_RULE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Tipo de valor"><Select name="value_type"><option value="percent">Porcentaje</option><option value="fixed">Valor fijo (COP)</option></Select></Field>
          <Field label="Valor"><Input name="value" required inputMode="decimal" /></Field>
          <ScopeFields {...lists} />
          <Field label="Código promocional (solo descuentos)"><Input name="promo_code" placeholder="Vacío = automático" /></Field>
          <Field label="Desde"><Input type="date" name="valid_from" /></Field>
          <Field label="Hasta"><Input type="date" name="valid_until" /></Field>
          <div className="flex items-end"><SubmitButton>Crear regla</SubmitButton></div>
        </form>
        <p className="mt-3 text-xs text-ink-soft">Para modificar una regla, desactívala y crea una nueva: así queda trazabilidad completa.</p>
      </Card>

      <Card>
        <h2 className="font-display text-lg font-bold">Festivos (recargo festivo)</h2>
        <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {holidays?.map((h) => (
            <li key={h.day} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5"><span>{formatDate(h.day, { dateStyle: "medium" })} · {h.name}</span>
              <form action={saveHoliday}><Back to={back} /><input type="hidden" name="day" value={h.day} /><input type="hidden" name="delete" value="1" /><button className="text-xs text-red-700">×</button></form></li>
          ))}
        </ul>
        <form action={saveHoliday} className="mt-4 flex flex-wrap items-end gap-2"><Back to={back} />
          <Field label="Fecha"><Input type="date" name="day" required /></Field><Field label="Nombre"><Input name="name" required /></Field><SubmitButton size="sm" variant="outline">Agregar festivo</SubmitButton>
        </form>
      </Card>
    </>
  );
}
