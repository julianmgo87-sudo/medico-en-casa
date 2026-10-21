import { Back, Badge, Card, Field, Flash, Input, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { CategoryIcon, ICON_NAMES } from "@/components/CategoryIcon";
import { createClient } from "@/lib/supabase/server";
import { integrationStatus } from "@/lib/env";
import { formatCOP, formatDateTime } from "@/lib/format";
import { AREA_TYPES } from "@/lib/status";
import { saveArea, saveCategory, saveSettings, saveSpecialty, setCategoryBooking, toggleRow } from "@/app/actions/admin";

export default async function AdminConfiguracion({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: settings }, { data: cats }, { data: specs }, { data: areas }] = await Promise.all([
    supabase.from("application_settings").select("*").order("key"),
    supabase.from("service_categories").select("*").order("sort_order"),
    supabase.from("specialties").select("*, category:service_categories(name)").order("name"),
    supabase.from("service_areas").select("*").order("area_type").order("name"),
  ]);
  const integ = integrationStatus();
  const back = "/admin/configuracion";
  const rows: [string, boolean, string][] = [
    ["Base de datos y autenticación (Supabase)", integ.supabase, "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY"],
    [`Pasarela de pagos Wompi (${integ.wompiEnv === "production" ? "producción" : "pruebas/sandbox"})`, integ.wompi, "NEXT_PUBLIC_WOMPI_PUBLIC_KEY, WOMPI_PRIVATE_KEY, WOMPI_INTEGRITY_SECRET, WOMPI_EVENTS_SECRET y URL de eventos en el panel de Wompi"],
    ["Correo transaccional (Resend)", integ.email, "RESEND_API_KEY, EMAIL_FROM con dominio verificado"],
    ["Procesos programados HTTP (respaldo de pg_cron)", integ.cron, "CRON_SECRET"],
    ["WhatsApp Business API", integ.whatsapp, "No implementado: el canal existe en el modelo de notificaciones"],
    ["Notificaciones push", integ.push, "No implementado"],
  ];

  return (
    <>
      <PageHeader title="Configuración general" />
      <Flash searchParams={sp} />
      <Card className="mb-6">
        <h2 className="font-display text-lg font-bold">Estado de integraciones</h2>
        <ul className="mt-3 divide-y divide-slate-100">
          {rows.map(([name, ok, need]) => (
            <li key={name} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span><strong>{name}</strong>{!ok && <span className="block text-xs text-ink-soft">Falta: {need}</span>}</span>
              <Badge tone={ok ? "green" : "amber"}>{ok ? "Configurada" : "No activa"}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mb-6">
        <h2 className="font-display text-lg font-bold">Parámetros de operación</h2>
        <form action={saveSettings} className="mt-4 grid gap-4 sm:grid-cols-2"><Back to={back} />
          {settings?.map((s) => (
            <Field key={s.key} label={s.description || s.key} hint={<span className="font-mono">{s.key}{s.is_public ? " · público" : ""}</span>}>
              {typeof s.value === "boolean" ? (
                <Select name={`s_${s.key}`} defaultValue={String(s.value)}><option value="true">Sí</option><option value="false">No</option></Select>
              ) : typeof s.value === "object" ? (
                <Textarea name={`s_${s.key}`} defaultValue={JSON.stringify(s.value, null, 1)} rows={3} className="font-mono text-xs" />
              ) : s.key === "commission_base" ? (
                <Select name={`s_${s.key}`} defaultValue={String(s.value)}><option value="service_amount">service_amount</option><option value="base_only">base_only</option><option value="service_and_travel">service_and_travel</option></Select>
              ) : s.key === "payout_frequency" ? (
                <Select name={`s_${s.key}`} defaultValue={String(s.value)}><option value="weekly">Semanal</option><option value="biweekly">Quincenal</option><option value="monthly">Mensual</option></Select>
              ) : (
                <Input name={`s_${s.key}`} defaultValue={String(s.value)} />
              )}
            </Field>
          ))}
          <div className="sm:col-span-2"><SubmitButton>Guardar parámetros</SubmitButton></div>
        </form>
      </Card>

      <h2 className="mb-3 font-display text-xl font-bold">Categorías de servicio</h2>
      <Notice kind="warning" className="mb-4" title="Habilitación regulatoria">No habilites reservas de una categoría sin verificar: prestador responsable (profesional independiente o IPS), inscripción en REPS con servicio en modalidad domiciliaria, alcance de los procedimientos permitidos en casa, pólizas y manejo de historia clínica.</Notice>
      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        {[...(cats ?? []), null].map((c, i) => (
          <Card key={c?.id ?? `n${i}`}>
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-display text-lg font-bold">{c && <CategoryIcon name={c.icon} className="h-5 w-5 text-brand-700" />}{c ? c.name : "Nueva categoría"}</h3>
              {c && <Badge tone={c.booking_enabled ? "green" : "amber"}>{c.booking_enabled ? "Reservable" : "No reservable"}</Badge>}
            </div>
            <form action={saveCategory} className="mt-3 grid gap-3 sm:grid-cols-2"><Back to={back} />{c && <input type="hidden" name="id" value={c.id} />}
              <Field label="Nombre"><Input name="name" defaultValue={c?.name} required /></Field>
              <Field label="Slug (URL)"><Input name="slug" defaultValue={c?.slug} required /></Field>
              <Field label="Ícono"><Select name="icon" defaultValue={c?.icon ?? "stethoscope"}>{ICON_NAMES.map((n) => <option key={n}>{n}</option>)}</Select></Field>
              <Field label="Orden"><Input name="sort_order" type="number" defaultValue={c?.sort_order ?? 10} /></Field>
              <Field label="Descripción" className="sm:col-span-2"><Input name="description" defaultValue={c?.description} /></Field>
              <Field label="Requisitos regulatorios / notas" className="sm:col-span-2"><Textarea name="regulatory_notes" defaultValue={c?.regulatory_notes} rows={3} /></Field>
              <div className="sm:col-span-2"><SubmitButton size="sm" variant="outline">Guardar</SubmitButton></div>
            </form>
            {c && (
              <form action={setCategoryBooking} className="mt-4 space-y-2 border-t border-slate-100 pt-3 text-sm"><Back to={back} /><input type="hidden" name="id" value={c.id} />
                {c.booking_enabled ? (
                  <><p className="text-xs text-ink-soft">Verificado {formatDateTime(c.regulatory_verified_at)}</p><input type="hidden" name="enable" value="0" /><SubmitButton size="sm" variant="danger">Deshabilitar reservas</SubmitButton></>
                ) : (
                  <><label className="flex gap-2"><input type="checkbox" name="verified" /> Verifiqué los requisitos regulatorios para prestar este servicio a domicilio.</label><input type="hidden" name="enable" value="1" /><SubmitButton size="sm" variant="secondary">Habilitar reservas</SubmitButton></>
                )}
              </form>
            )}
            {c && (
              <form action={toggleRow} className="mt-2"><Back to={back} /><input type="hidden" name="table" value="service_categories" /><input type="hidden" name="id" value={c.id} /><input type="hidden" name="value" value={c.is_active ? "0" : "1"} />
                <button className="text-xs font-semibold text-ink-soft">{c.is_active ? "Ocultar del catálogo" : "Mostrar en el catálogo"}</button></form>
            )}
          </Card>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold">Especialidades</h2>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {specs?.map((s) => (
              <li key={s.id} className="flex items-center justify-between py-2"><span>{(Array.isArray(s.category) ? s.category[0] : s.category)?.name} — <strong>{s.name}</strong> · ref. {s.default_hourly_rate ? formatCOP(s.default_hourly_rate) : "—"}</span>
                <form action={toggleRow}><Back to={back} /><input type="hidden" name="table" value="specialties" /><input type="hidden" name="id" value={s.id} /><input type="hidden" name="value" value={s.is_active ? "0" : "1"} /><button className="text-xs font-semibold text-brand-700">{s.is_active ? "Desactivar" : "Activar"}</button></form></li>
            ))}
          </ul>
          <form action={saveSpecialty} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><Back to={back} />
            <Field label="Categoría"><Select name="category_id" required>{cats?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Nombre"><Input name="name" required /></Field>
            <Field label="Slug"><Input name="slug" required /></Field>
            <Field label="Tarifa referencia / hora"><Input name="default_hourly_rate" inputMode="numeric" /></Field>
            <Field label="Duración (min)"><Input name="default_duration_min" type="number" defaultValue={60} /></Field>
            <Field label="Descripción"><Input name="description" /></Field>
            <div><SubmitButton size="sm" variant="outline">Crear especialidad</SubmitButton></div>
          </form>
        </Card>
        <Card>
          <h2 className="font-display text-lg font-bold">Zonas de cobertura</h2>
          <p className="text-xs text-ink-soft">Los profesionales que cubren una zona padre (p. ej. el municipio o la comuna) cubren todas sus subzonas. La tarifa de desplazamiento es la de la zona de la dirección.</p>
          <ul className="mt-3 max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm">
            {areas?.map((a) => (
              <li key={a.id} className={`flex flex-wrap items-center justify-between gap-2 py-2 ${a.is_active ? "" : "opacity-50"}`}>
                <span>{a.name} <span className="text-xs text-ink-faint">{AREA_TYPES[a.area_type]} · {a.municipality}</span></span>
                <span className="flex items-center gap-2">
                  <form action={saveArea} className="flex items-center gap-1"><Back to={back} /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="name" value={a.name} /><input type="hidden" name="area_type" value={a.area_type} />
                    <Input name="travel_fee" defaultValue={a.travel_fee} className="!w-24 !py-1 text-xs" inputMode="numeric" /><button className="text-xs font-semibold text-brand-700">Guardar</button></form>
                  <form action={toggleRow}><Back to={back} /><input type="hidden" name="table" value="service_areas" /><input type="hidden" name="id" value={a.id} /><input type="hidden" name="value" value={a.is_active ? "0" : "1"} /><button className="text-xs text-ink-soft">{a.is_active ? "Desactivar" : "Activar"}</button></form>
                </span>
              </li>
            ))}
          </ul>
          <form action={saveArea} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2"><Back to={back} />
            <Field label="Nombre"><Input name="name" required placeholder="Barrio Zamorano" /></Field>
            <Field label="Tipo"><Select name="area_type">{Object.entries(AREA_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Pertenece a"><Select name="parent_id" defaultValue=""><option value="">— (nivel superior)</option>{areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
            <Field label="Desplazamiento (COP)"><Input name="travel_fee" inputMode="numeric" defaultValue={10000} /></Field>
            <Field label="Municipio"><Input name="municipality" defaultValue="Palmira" /></Field>
            <Field label="Departamento"><Input name="department" defaultValue="Valle del Cauca" /></Field>
            <div><SubmitButton size="sm" variant="outline">Agregar zona</SubmitButton></div>
          </form>
        </Card>
      </div>
    </>
  );
}
