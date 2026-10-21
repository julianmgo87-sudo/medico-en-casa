import { Back, Card, Field, Flash, Input, PageHeader, Select } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addAddress } from "@/app/actions/booking";
import { archiveAddress, setDefaultAddress, updatePatientProfile } from "@/app/actions/patient";

export default async function PerfilPacientePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireRole("patient");
  const supabase = await createClient();
  const [{ data: profile }, { data: addresses }, { data: areas }] = await Promise.all([
    supabase.from("patient_profiles").select("*").eq("user_id", user.id).single(),
    supabase.from("patient_addresses").select("*, area:service_areas(name)").eq("patient_id", user.id).eq("is_archived", false).order("created_at"),
    supabase.from("service_areas").select("id, name, area_type").eq("is_active", true).neq("area_type", "municipio").order("area_type").order("name"),
  ]);
  return (
    <>
      <PageHeader title="Perfil y direcciones" subtitle={user.email} />
      <Flash searchParams={sp} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold">Datos personales</h2>
          <form action={updatePatientProfile} className="mt-4 grid gap-3 sm:grid-cols-2">
            <Back to="/paciente/perfil" />
            <Field label="Nombre completo" className="sm:col-span-2"><Input name="full_name" defaultValue={user.full_name} required /></Field>
            <Field label="Celular"><Input name="phone" defaultValue={user.phone ?? ""} required /></Field>
            <Field label="Fecha de nacimiento"><Input type="date" name="birth_date" defaultValue={profile?.birth_date ?? ""} /></Field>
            <Field label="Tipo de documento">
              <Select name="document_type" defaultValue={profile?.document_type ?? ""}>
                <option value="">—</option>{["CC", "CE", "TI", "PA", "PPT"].map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Field>
            <Field label="Número de documento"><Input name="document_number" defaultValue={profile?.document_number ?? ""} /></Field>
            <Field label="Contacto de emergencia"><Input name="emergency_contact_name" defaultValue={profile?.emergency_contact_name ?? ""} /></Field>
            <Field label="Teléfono de emergencia"><Input name="emergency_contact_phone" defaultValue={profile?.emergency_contact_phone ?? ""} /></Field>
            <div className="sm:col-span-2"><SubmitButton>Guardar</SubmitButton></div>
          </form>
          <p className="mt-4 text-xs text-ink-soft">Para cambiar tu correo o solicitar la eliminación de tus datos, escribe a soporte (Ley 1581 de 2012).</p>
        </Card>
        <Card>
          <h2 className="font-display text-lg font-bold">Mis direcciones</h2>
          <ul className="mt-3 space-y-2">
            {addresses?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <span><strong>{a.label}</strong>{a.is_default && " (principal)"}: {a.address_line} · {(Array.isArray(a.area) ? a.area[0] : a.area)?.name}</span>
                <span className="flex gap-2">
                  {!a.is_default && <form action={setDefaultAddress}><Back to="/paciente/perfil" /><input type="hidden" name="address_id" value={a.id} /><button className="text-xs font-semibold text-brand-700">Principal</button></form>}
                  <form action={archiveAddress}><Back to="/paciente/perfil" /><input type="hidden" name="address_id" value={a.id} /><button className="text-xs font-semibold text-red-700">Eliminar</button></form>
                </span>
              </li>
            ))}
          </ul>
          <form action={addAddress} className="mt-5 grid gap-3 border-t border-slate-100 pt-5 sm:grid-cols-2">
            <Back to="/paciente/perfil" />
            <Field label="Nombre"><Input name="label" placeholder="Casa" /></Field>
            <Field label="Comuna / corregimiento / barrio">
              <Select name="service_area_id" required defaultValue=""><option value="" disabled>Selecciona…</option>{areas?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            </Field>
            <Field label="Dirección" className="sm:col-span-2"><Input name="address_line" required /></Field>
            <Field label="Barrio"><Input name="neighborhood" /></Field>
            <Field label="Indicaciones"><Input name="reference_notes" /></Field>
            <div className="sm:col-span-2"><SubmitButton variant="outline">Agregar dirección</SubmitButton></div>
          </form>
        </Card>
      </div>
    </>
  );
}
