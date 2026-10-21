import { Field, Select } from "@/components/ui";
import { SCOPES } from "@/lib/status";

type Opt = { id: string; name: string };

/** Selector de alcance (general / categoría / especialidad / profesional / tipo de atención). */
export function ScopeFields({ categories, specialties, professionals, withCareType = false }: { categories: Opt[]; specialties: Opt[]; professionals: Opt[]; withCareType?: boolean }) {
  return (
    <>
      <Field label="Alcance"><Select name="scope" defaultValue="global">
        {Object.entries(SCOPES).filter(([k]) => withCareType || k !== "care_type").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </Select></Field>
      <Field label="Categoría (si aplica)"><Select name="category_id" defaultValue=""><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="Especialidad (si aplica)"><Select name="specialty_id" defaultValue=""><option value="">—</option>{specialties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="Profesional (si aplica)"><Select name="professional_id" defaultValue=""><option value="">—</option>{professionals.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      {withCareType && <Field label="Tipo de atención (si aplica)"><Select name="care_type" defaultValue=""><option value="">—</option><option value="scheduled">Consulta programada</option><option value="priority">Atención prioritaria</option></Select></Field>}
    </>
  );
}
