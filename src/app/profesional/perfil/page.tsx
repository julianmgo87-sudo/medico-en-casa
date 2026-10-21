import { Back, Card, Field, Flash, Input, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { Avatar } from "@/components/ProfessionalCard";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatCOP, formatDate } from "@/lib/format";
import { AREA_TYPES, CREDENTIAL_TYPES, PROFESSIONAL_STATUS } from "@/lib/status";
import { deleteCredential, saveProfessionalProfile, savePayoutAccount, submitForReview, uploadCredential, uploadPhoto } from "@/app/actions/professional";

const CRED_STATUS = { pending: { label: "En revisión", tone: "amber" as const }, approved: { label: "Aprobado", tone: "green" as const }, rejected: { label: "Rechazado", tone: "red" as const } };

export default async function PerfilProfesionalPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireRole("professional");
  const supabase = await createClient();
  const [{ data: p }, { data: specialties }, { data: areas }, { data: myAreas }, { data: creds }, { data: account }] = await Promise.all([
    supabase.from("professional_profiles").select("*").eq("user_id", user.id).single(),
    supabase.from("specialties").select("id, name, category:service_categories(name)").eq("is_active", true).order("name"),
    supabase.from("service_areas").select("id, name, area_type").eq("is_active", true).order("area_type").order("name"),
    supabase.from("professional_service_areas").select("service_area_id").eq("professional_id", user.id),
    supabase.from("professional_credentials").select("*").eq("professional_id", user.id).order("created_at"),
    supabase.from("professional_payout_accounts").select("method, bank_name, account_type, account_number, phone_number, holder_name, holder_document, verified_at").eq("professional_id", user.id).maybeSingle(),
  ]);
  const locked = p?.status === "approved";
  const zoneIds = new Set(myAreas?.map((z) => z.service_area_id));
  const back = "/profesional/perfil";

  return (
    <>
      <PageHeader title="Perfil y documentos" actions={p && <StatusBadge map={PROFESSIONAL_STATUS} value={p.status} />} />
      <Flash searchParams={sp} />
      {p?.status === "rejected" && <Notice kind="error" className="mb-6" title="Ajustes solicitados por el administrador">{p.rejection_reason}</Notice>}
      {locked && <Notice kind="info" className="mb-6">Tu perfil está aprobado. Profesión, especialidad, documento y registros solo pueden cambiarse a través del administrador para proteger la verificación.</Notice>}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-lg font-bold">Información profesional</h2>
            <form action={saveProfessionalProfile} className="mt-4 grid gap-3 sm:grid-cols-2">
              <Back to={back} />
              <Field label="Nombre completo"><Input name="full_name" defaultValue={user.full_name} required /></Field>
              <Field label="Celular"><Input name="phone" defaultValue={user.phone ?? ""} /></Field>
              <Field label="Tipo de documento"><Select name="document_type" defaultValue={p?.document_type ?? "CC"} disabled={locked}>{["CC", "CE", "PA", "PPT"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Número de documento" hint="No se publica."><Input name="document_number" defaultValue={p?.document_number ?? ""} disabled={locked} /></Field>
              <Field label="Profesión"><Input name="profession" defaultValue={p?.profession ?? ""} placeholder="Médico general, Fisioterapeuta…" required={!locked} disabled={locked} /></Field>
              <Field label="Servicio / especialidad">
                <Select name="specialty_id" defaultValue={p?.specialty_id ?? ""} required disabled={locked}>
                  <option value="" disabled>Selecciona…</option>
                  {specialties?.map((s) => <option key={s.id} value={s.id}>{(Array.isArray(s.category) ? s.category[0] : s.category)?.name} — {s.name}</option>)}
                </Select>
              </Field>
              {locked && <input type="hidden" name="specialty_id" value={p?.specialty_id ?? ""} />}
              <Field label="Registro / tarjeta profesional"><Input name="professional_registration" defaultValue={p?.professional_registration ?? ""} disabled={locked} /></Field>
              <Field label="Número RETHUS" hint="Lo verificamos en rethus.minsalud.gov.co"><Input name="rethus_number" defaultValue={p?.rethus_number ?? ""} disabled={locked} /></Field>
              <Field label="Años de experiencia"><Input name="years_experience" type="number" min={0} max={70} defaultValue={p?.years_experience ?? ""} /></Field>
              <Field label="Tarifa por hora propuesta (COP)" hint={p?.approved_hourly_rate ? `Tarifa aprobada: ${formatCOP(p.approved_hourly_rate)}` : "El administrador define la tarifa final."}>
                <Input name="proposed_hourly_rate" inputMode="numeric" defaultValue={p?.proposed_hourly_rate ?? ""} required />
              </Field>
              <Field label="Duración de cada cita (min)" hint="30, 60, 90 o personalizada"><Input name="default_duration_min" type="number" min={15} max={480} step={5} defaultValue={p?.default_duration_min ?? 60} /></Field>
              <Field label="Tiempo de desplazamiento entre citas (min)"><Input name="travel_buffer_min" type="number" min={0} max={240} step={5} defaultValue={p?.travel_buffer_min ?? 30} /></Field>
              <Field label="Biografía profesional" className="sm:col-span-2"><Textarea name="bio" rows={5} maxLength={2000} defaultValue={p?.bio ?? ""} /></Field>
              <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-semibold">Zonas donde prestas servicio</legend>
                <p className="mb-2 text-xs text-ink-soft">Si seleccionas “Palmira” (municipio) cubres todas sus comunas y corregimientos.</p>
                <div className="grid gap-1.5 sm:grid-cols-3">
                  {areas?.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="zones" value={a.id} defaultChecked={zoneIds.has(a.id)} /> {a.name} <span className="text-xs text-ink-faint">({AREA_TYPES[a.area_type]})</span></label>
                  ))}
                </div>
              </fieldset>
              <div className="sm:col-span-2"><SubmitButton>Guardar perfil</SubmitButton></div>
            </form>
          </Card>

          <Card>
            <h2 className="font-display text-lg font-bold">Títulos, certificaciones y documentos</h2>
            <p className="mt-1 text-sm text-ink-soft">Los archivos se guardan en almacenamiento privado; solo tú y el administrador pueden verlos. En tu perfil público solo aparecen el título y la institución de los documentos aprobados.</p>
            <ul className="mt-4 divide-y divide-slate-100">
              {creds?.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span><strong>{c.title}</strong> · {CREDENTIAL_TYPES[c.credential_type]}{c.institution ? ` · ${c.institution}` : ""}{c.issued_on ? ` · ${formatDate(c.issued_on, { year: "numeric" })}` : ""}
                    {c.review_notes && <span className="block text-xs text-red-700">{c.review_notes}</span>}</span>
                  <span className="flex items-center gap-2"><StatusBadge map={CRED_STATUS} value={c.status} />
                    {c.status === "pending" && <form action={deleteCredential}><Back to={back} /><input type="hidden" name="credential_id" value={c.id} /><button className="text-xs font-semibold text-red-700">Eliminar</button></form>}</span>
                </li>
              ))}
              {!creds?.length && <li className="py-2 text-sm text-ink-soft">Aún no has cargado documentos.</li>}
            </ul>
            <form action={uploadCredential} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <Back to={back} />
              <Field label="Tipo"><Select name="credential_type" required>{Object.entries(CREDENTIAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="Título / nombre del documento"><Input name="title" required placeholder="Médico y cirujano" /></Field>
              <Field label="Institución"><Input name="institution" /></Field>
              <Field label="Fecha de expedición"><Input type="date" name="issued_on" /></Field>
              <Field label="Archivo (PDF, JPG o PNG, máx. 10 MB)" className="sm:col-span-2"><Input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required /></Field>
              <div><SubmitButton variant="outline">Subir documento</SubmitButton></div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-lg font-bold">Fotografía</h2>
            <div className="mt-3 flex items-center gap-4">
              <Avatar name={user.full_name} path={p?.photo_path ?? null} className="h-20 w-20" />
              <form action={uploadPhoto} className="space-y-2"><Back to={back} />
                <Input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required />
                <SubmitButton size="sm" variant="outline">Subir foto</SubmitButton></form>
            </div>
          </Card>

          <Card>
            <h2 className="font-display text-lg font-bold">Datos para liquidaciones</h2>
            <p className="mt-1 text-xs text-ink-soft">{account?.verified_at ? "Cuenta verificada por el administrador." : "Pendiente de verificación por el administrador."} Si cambias la cuenta, deberá verificarse de nuevo.</p>
            <form action={savePayoutAccount} className="mt-3 space-y-3">
              <Back to={back} />
              <Field label="Medio"><Select name="method" defaultValue={account?.method ?? "bank_account"}><option value="bank_account">Cuenta bancaria</option><option value="nequi">Nequi</option><option value="daviplata">Daviplata</option></Select></Field>
              <Field label="Banco (si es cuenta bancaria)"><Input name="bank_name" defaultValue={account?.bank_name ?? ""} /></Field>
              <Field label="Tipo de cuenta"><Select name="account_type" defaultValue={account?.account_type ?? "ahorros"}><option value="ahorros">Ahorros</option><option value="corriente">Corriente</option></Select></Field>
              <Field label="Número de cuenta"><Input name="account_number" inputMode="numeric" defaultValue={account?.account_number ?? ""} autoComplete="off" /></Field>
              <Field label="Celular (Nequi / Daviplata)"><Input name="phone_number" inputMode="tel" defaultValue={account?.phone_number ?? ""} /></Field>
              <Field label="Titular"><Input name="holder_name" defaultValue={account?.holder_name ?? user.full_name} required /></Field>
              <Field label="Documento del titular"><Input name="holder_document" defaultValue={account?.holder_document ?? ""} required /></Field>
              <SubmitButton variant="outline">Guardar datos de pago</SubmitButton>
            </form>
          </Card>

          {(p?.status === "draft" || p?.status === "rejected") && (
            <Card className="border-brand-200 bg-brand-50">
              <h2 className="font-display text-lg font-bold">Enviar a revisión</h2>
              <p className="mt-1 text-sm text-ink-soft">Cuando tengas el perfil, documentos, zonas y agenda completos, envíalo para aprobación.</p>
              <form action={submitForReview} className="mt-3"><Back to={back} /><SubmitButton>Enviar perfil a revisión</SubmitButton></form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
