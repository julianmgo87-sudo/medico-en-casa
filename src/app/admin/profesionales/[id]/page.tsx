import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Avatar } from "@/components/ProfessionalCard";
import { Back, Card, Field, Flash, Input, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { formatCOP, formatDate, formatDateTime } from "@/lib/format";
import { CREDENTIAL_TYPES, PROFESSIONAL_STATUS } from "@/lib/status";
import { adminAddCredential, adminUpdateProfessional, adminUploadPhoto, approveProfessional, reactivateProfessional, rejectProfessional, reviewCredential, setUserStatus, verifyPayoutAccount, verifyRethus } from "@/app/actions/admin";

const CRED_STATUS = { pending: { label: "Pendiente", tone: "amber" as const }, approved: { label: "Aprobado", tone: "green" as const }, rejected: { label: "Rechazado", tone: "red" as const } };

export default async function AdminProfesionalDetalle({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: p } = await supabase.from("professional_profiles").select("*, user:users!professional_profiles_user_id_fkey(full_name, email, phone, status, created_at)").eq("user_id", id).maybeSingle();
  if (!p) notFound();
  const u = (Array.isArray(p.user) ? p.user[0] : p.user) as { full_name: string; email: string; phone: string; status: string; created_at: string };
  const [{ data: creds }, { data: zones }, { data: account }, { data: specialties }, { data: windows }] = await Promise.all([
    supabase.from("professional_credentials").select("*").eq("professional_id", id).order("created_at"),
    supabase.from("professional_service_areas").select("area:service_areas(name)").eq("professional_id", id),
    supabase.from("professional_payout_accounts").select("*").eq("professional_id", id).maybeSingle(),
    supabase.from("specialties").select("id, name").order("name"),
    supabase.from("professional_availability").select("weekday, start_time, end_time").eq("professional_id", id),
  ]);
  const signed = await Promise.all((creds ?? []).map(async (c) => c.file_path ? (await supabase.storage.from("professional-documents").createSignedUrl(c.file_path, 600)).data?.signedUrl ?? null : null));
  const here = `/admin/profesionales/${id}`;

  return (
    <>
      <PageHeader title={u.full_name || "Profesional"} subtitle={`${u.email} · ${u.phone ?? "sin celular"} · registrado ${formatDate(u.created_at)}`} actions={<StatusBadge map={PROFESSIONAL_STATUS} value={p.status} />} />
      <Flash searchParams={sp} />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-lg font-bold">Documentos y credenciales</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {creds?.map((c, i) => (
                <li key={c.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{c.title} <span className="text-sm font-normal text-ink-soft">· {CREDENTIAL_TYPES[c.credential_type]}</span></p>
                      <p className="text-sm text-ink-soft">{c.institution ?? "—"}{c.issued_on ? ` · ${formatDate(c.issued_on)}` : ""}</p>
                      {signed[i] && <a href={signed[i]!} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-brand-700">Ver archivo (enlace temporal) ↗</a>}
                    </div>
                    <StatusBadge map={CRED_STATUS} value={c.status} />
                  </div>
                  {c.status === "pending" && (
                    <form action={reviewCredential} className="mt-2 flex flex-wrap items-end gap-2">
                      <Back to={here} /><input type="hidden" name="credential_id" value={c.id} />
                      <Input name="notes" placeholder="Observación (obligatoria si rechazas)" className="max-w-sm" />
                      <button name="decision" value="approve" className="h-9 rounded-full bg-teal-600 px-4 text-sm font-semibold text-white">Aprobar</button>
                      <button name="decision" value="reject" className="h-9 rounded-full bg-red-600 px-4 text-sm font-semibold text-white">Rechazar</button>
                    </form>
                  )}
                </li>
              ))}
              {!creds?.length && <li className="py-2 text-sm text-ink-soft">Sin documentos.</li>}
            </ul>
            <details className="mt-3 border-t border-slate-100 pt-3 text-sm">
              <summary className="cursor-pointer font-semibold">Agregar credencial en nombre del profesional</summary>
              <form action={adminAddCredential} className="mt-3 grid gap-3 sm:grid-cols-2">
                <Back to={here} /><input type="hidden" name="professional_id" value={id} />
                <Field label="Tipo"><Select name="credential_type">{Object.entries(CREDENTIAL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Título"><Input name="title" required /></Field>
                <Field label="Institución"><Input name="institution" /></Field>
                <Field label="Fecha"><Input type="date" name="issued_on" /></Field>
                <Field label="Archivo" className="sm:col-span-2"><Input type="file" name="file" accept="application/pdf,image/jpeg,image/png" /></Field>
                <div><SubmitButton size="sm" variant="outline">Agregar</SubmitButton></div>
              </form>
            </details>
          </Card>

          <Card>
            <h2 className="font-display text-lg font-bold">Editar perfil</h2>
            <form action={adminUpdateProfessional} className="mt-4 grid gap-3 sm:grid-cols-2">
              <Back to={here} /><input type="hidden" name="professional_id" value={id} />
              <Field label="Nombre"><Input name="full_name" defaultValue={u.full_name} required /></Field>
              <Field label="Profesión"><Input name="profession" defaultValue={p.profession} required /></Field>
              <Field label="Especialidad"><Select name="specialty_id" defaultValue={p.specialty_id ?? ""} required><option value="" disabled>—</option>{specialties?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Registro profesional"><Input name="professional_registration" defaultValue={p.professional_registration ?? ""} /></Field>
              <Field label="RETHUS"><Input name="rethus_number" defaultValue={p.rethus_number ?? ""} /></Field>
              <Field label="Tipo doc."><Select name="document_type" defaultValue={p.document_type ?? "CC"}>{["CC", "CE", "PA", "PPT"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
              <Field label="Documento"><Input name="document_number" defaultValue={p.document_number ?? ""} /></Field>
              <Field label="Años de experiencia"><Input name="years_experience" type="number" defaultValue={p.years_experience ?? ""} /></Field>
              <Field label="Tarifa final aprobada / hora (COP)"><Input name="approved_hourly_rate" inputMode="numeric" defaultValue={p.approved_hourly_rate ?? ""} /></Field>
              <Field label="Duración cita (min)"><Input name="default_duration_min" type="number" defaultValue={p.default_duration_min} /></Field>
              <Field label="Desplazamiento entre citas (min)"><Input name="travel_buffer_min" type="number" defaultValue={p.travel_buffer_min} /></Field>
              <Field label="Biografía" className="sm:col-span-2"><Textarea name="bio" defaultValue={p.bio} rows={4} /></Field>
              <div className="sm:col-span-2"><SubmitButton variant="outline">Guardar cambios</SubmitButton></div>
            </form>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <div className="flex items-center gap-4">
              <Avatar name={u.full_name} path={p.photo_path} className="h-20 w-20" />
              <form action={adminUploadPhoto} className="space-y-2"><Back to={here} /><input type="hidden" name="professional_id" value={id} />
                <Input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required /><SubmitButton size="sm" variant="outline">Actualizar foto</SubmitButton></form>
            </div>
            <dl className="mt-4 space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-ink-soft">Tarifa propuesta</dt><dd>{p.proposed_hourly_rate ? formatCOP(p.proposed_hourly_rate) : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Zonas</dt><dd className="text-right">{zones?.map((z) => (Array.isArray(z.area) ? z.area[0] : z.area)?.name).join(", ") || "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Franjas de agenda</dt><dd>{windows?.length ?? 0}</dd></div>
            </dl>
          </Card>

          <Card>
            <h2 className="font-display text-lg font-bold">RETHUS</h2>
            <p className="mt-1 text-sm">Número: <strong>{p.rethus_number ?? "—"}</strong> · Documento: <strong>{p.document_type} {p.document_number ?? "—"}</strong></p>
            <a href="https://web.sispro.gov.co/THS/Cliente/ConsultasPublicas/ConsultaPublicaDeTHxIdentificacion.aspx" target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">Consultar en RETHUS (SISPRO) <ExternalLink className="h-3.5 w-3.5" /></a>
            <p className="mt-2 text-xs text-ink-soft">La consulta es manual. Verifica nombre, documento, profesión y estado. Esta plataforma no se conecta automáticamente a RETHUS.</p>
            <form action={verifyRethus} className="mt-3"><Back to={here} /><input type="hidden" name="professional_id" value={id} />
              {p.rethus_verified_at
                ? <><p className="mb-2 text-sm text-teal-700">Verificado el {formatDateTime(p.rethus_verified_at)}</p><button name="verified" value="0" className="text-sm font-semibold text-red-700">Retirar verificación</button></>
                : <SubmitButton size="sm" name="verified" value="1" variant="secondary">Marcar RETHUS verificado</SubmitButton>}
            </form>
          </Card>

          <Card>
            <h2 className="font-display text-lg font-bold">Cuenta para liquidaciones</h2>
            {account ? (
              <>
                <p className="mt-2 text-sm">{account.method === "bank_account" ? `${account.bank_name} · ${account.account_type} · ${account.account_number}` : `${account.method} · ${account.phone_number}`}</p>
                <p className="text-sm text-ink-soft">{account.holder_name} · {account.holder_document}</p>
                {account.verified_at ? <p className="mt-2 text-sm text-teal-700">Verificada {formatDateTime(account.verified_at)}</p> : (
                  <form action={verifyPayoutAccount} className="mt-3"><Back to={here} /><input type="hidden" name="professional_id" value={id} /><SubmitButton size="sm" variant="outline">Marcar cuenta verificada</SubmitButton></form>
                )}
              </>
            ) : <p className="mt-2 text-sm text-ink-soft">No ha registrado cuenta.</p>}
          </Card>

          {p.status !== "approved" && p.status !== "suspended" && (
            <Card className="border-teal-200">
              <h2 className="font-display text-lg font-bold">Aprobar profesional</h2>
              <form action={approveProfessional} className="mt-3 space-y-3"><Back to={here} /><input type="hidden" name="professional_id" value={id} />
                <Field label="Tarifa final por hora (COP)" hint="Es la que paga el paciente como base."><Input name="hourly_rate" inputMode="numeric" defaultValue={p.approved_hourly_rate ?? p.proposed_hourly_rate ?? ""} required /></Field>
                <Field label="Notas"><Input name="notes" /></Field>
                <SubmitButton variant="secondary">Aprobar y habilitar</SubmitButton>
              </form>
              <form action={rejectProfessional} className="mt-5 space-y-3 border-t border-slate-100 pt-4"><Back to={here} /><input type="hidden" name="professional_id" value={id} />
                <Field label="Solicitar ajustes / rechazar"><Textarea name="reason" required placeholder="Indica qué debe corregir" /></Field>
                <SubmitButton variant="outline">Enviar observaciones</SubmitButton>
              </form>
            </Card>
          )}
          {p.status === "suspended" && (
            <form action={reactivateProfessional}><Back to={here} /><input type="hidden" name="professional_id" value={id} /><SubmitButton variant="outline">Devolver a revisión</SubmitButton></form>
          )}
          <Card>
            <h2 className="font-display text-lg font-bold">Estado de la cuenta</h2>
            {u.status === "active" ? (
              <form action={setUserStatus} className="mt-3 space-y-2"><Back to={here} /><input type="hidden" name="user_id" value={id} /><input type="hidden" name="status" value="suspended" />
                <Input name="reason" placeholder="Motivo de la suspensión" required /><SubmitButton size="sm" variant="danger" confirm="¿Suspender esta cuenta?">Suspender</SubmitButton></form>
            ) : (
              <>
                <Notice kind="error" className="mt-3">Cuenta suspendida.</Notice>
                <form action={setUserStatus} className="mt-3"><Back to={here} /><input type="hidden" name="user_id" value={id} /><input type="hidden" name="status" value="active" /><SubmitButton size="sm" variant="outline">Reactivar cuenta</SubmitButton></form>
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
