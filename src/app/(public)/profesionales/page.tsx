import type { Metadata } from "next";
import { ProfessionalCard } from "@/components/ProfessionalCard";
import { Button, EmptyState, Field, Input, PageHeader, Select } from "@/components/ui";
import { getCatalog, type PublicProfessional } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { bogotaDate, addDays } from "@/lib/format";

export const metadata: Metadata = { title: "Directorio de profesionales" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | undefined>>;

export default async function DirectorioPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const catalog = await getCatalog();
  const [{ data: specialties }, { data: areas }] = await Promise.all([
    supabase.from("specialties").select("id, name, category_id").eq("is_active", true).order("name"),
    supabase.from("service_areas").select("id, name, area_type").eq("is_active", true).order("name"),
  ]);

  let q = supabase.from("public_professionals").select("*");
  if (sp.servicio) q = q.eq("category_slug", sp.servicio);
  if (sp.especialidad) q = q.eq("specialty_id", sp.especialidad);
  if (sp.precio_max) q = q.lte("price_from", Number(sp.precio_max));
  if (sp.q) q = q.ilike("full_name", `%${sp.q.replace(/[%_,()]/g, "")}%`);
  q = sp.orden === "precio" ? q.order("price_from") : q.order("rating_avg", { ascending: false });
  const { data } = await q;
  let pros = (data as PublicProfessional[]) ?? [];

  // Filtros que requieren lógica de servidor: cobertura por zona y disponibilidad real.
  if (sp.zona) {
    const checks = await Promise.all(pros.map((p) => supabase.rpc("professional_covers_area", { p_prof: p.id, p_area: sp.zona })));
    pros = pros.filter((_, i) => checks[i].data === true);
  }
  if (sp.disponible) {
    const from = bogotaDate();
    const to = addDays(from, sp.disponible === "hoy" ? 0 : 6);
    const checks = await Promise.all(pros.map((p) => supabase.rpc("get_available_slots", { p_prof: p.id, p_from: from, p_to: to }).limit(1)));
    pros = pros.filter((_, i) => (checks[i].data as unknown[] | null)?.length);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader title="Directorio de profesionales" subtitle="Todos los perfiles publicados fueron revisados por el equipo de Médico en Casa Palmira." />
      <form className="mb-8 grid gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-card sm:grid-cols-2 lg:grid-cols-6" method="get">
        <Field label="Nombre"><Input name="q" defaultValue={sp.q} placeholder="Buscar…" /></Field>
        <Field label="Profesión / servicio">
          <Select name="servicio" defaultValue={sp.servicio ?? ""}>
            <option value="">Todos</option>
            {catalog.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Especialidad">
          <Select name="especialidad" defaultValue={sp.especialidad ?? ""}>
            <option value="">Todas</option>
            {specialties?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Zona">
          <Select name="zona" defaultValue={sp.zona ?? ""}>
            <option value="">Cualquiera</option>
            {areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label="Disponibilidad">
          <Select name="disponible" defaultValue={sp.disponible ?? ""}>
            <option value="">Cualquiera</option>
            <option value="hoy">Hoy</option>
            <option value="semana">Próximos 7 días</option>
          </Select>
        </Field>
        <Field label="Precio máximo (COP)"><Input name="precio_max" inputMode="numeric" defaultValue={sp.precio_max} placeholder="Ej. 150000" /></Field>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <Select name="orden" defaultValue={sp.orden ?? ""} className="max-w-xs">
            <option value="">Mejor calificados</option>
            <option value="precio">Menor precio</option>
          </Select>
          <Button type="submit">Filtrar</Button>
        </div>
      </form>
      {pros.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{pros.map((p) => <ProfessionalCard key={p.id} p={p} />)}</div>
      ) : (
        <EmptyState title="No encontramos profesionales con esos filtros.">Prueba ampliar la zona, la fecha o el precio.</EmptyState>
      )}
    </div>
  );
}
