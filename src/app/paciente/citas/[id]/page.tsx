import Link from "next/link";
import { notFound } from "next/navigation";
import { Back, Card, Field, Flash, Input, Notice, PageHeader, Select, StatusBadge, Textarea, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, bogotaDate, formatCOP, formatDateTime } from "@/lib/format";
import { APPOINTMENT_STATUS, CARE_TYPE, PAYMENT_STATE, REFUND_STATUS } from "@/lib/status";
import { getPublicSettings, settingNumber } from "@/lib/data";
import { isWompiConfigured } from "@/lib/wompi";
import { payAppointment } from "@/app/actions/payments";
import { acceptAlternative, cancelAppointment, confirmCompletion, openDispute, requestRefundInstead, rescheduleAppointment, submitReview } from "@/app/actions/patient";

type Alt = { professional_id: string; full_name: string; specialty: string; rating_avg: number; starts_at: string; same_time: boolean; total_amount: number; price_difference: number };

export default async function CitaDetallePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireRole("patient");
  const supabase = await createClient();
  const { data: a } = await supabase.from("appointments").select("*, specialty:specialties(name)").eq("id", id).eq("patient_id", user.id).maybeSingle();
  if (!a) notFound();
  const here = `/paciente/citas/${id}`;
  const settings = await getPublicSettings();
  const [{ data: history }, { data: pro }, { data: refunds }, { data: payments }, { data: review }] = await Promise.all([
    supabase.from("appointment_status_history").select("to_status, reason, created_at, actor_role").eq("appointment_id", id).order("created_at"),
    supabase.from("public_professionals").select("id, full_name, profession").eq("id", a.professional_id).maybeSingle(),
    supabase.from("refunds").select("id, amount, status, reason, provider_reference, processed_at").eq("appointment_id", id).order("requested_at"),
    supabase.from("payments").select("id, reference, status, amount, approved_at").eq("appointment_id", id).order("created_at"),
    supabase.from("reviews").select("rating, comment").eq("appointment_id", id).maybeSingle(),
  ]);
  const breakdown = (a.price_breakdown?.lines ?? []) as { label: string; amount: number }[];
  const hoursBefore = (new Date(a.starts_at).getTime() - Date.now()) / 36e5;
  const freeH = settingNumber(settings, "free_cancellation_hours", 24);
  const latePct = settingNumber(settings, "late_cancellation_refund_percent", 50);
  const approvedPayment = payments?.find((p) => p.status === "approved");

  let alternatives: Alt[] = [];
  if (a.status === "pending_reassignment") {
    const { data } = await supabase.rpc("find_alternatives", { p_appointment: id });
    alternatives = (data as Alt[]) ?? [];
  }
  let rescheduleSlots: { starts_at: string }[] = [];
  const canReschedule = ["pending_acceptance", "confirmed"].includes(a.status) && hoursBefore >= freeH;
  if (canReschedule) {
    const today = bogotaDate();
    const { data } = await supabase.rpc("get_available_slots", { p_prof: a.professional_id, p_from: today, p_to: addDays(today, 13), p_care: a.care_type, p_duration_min: a.duration_min, p_exclude_appointment: id });
    rescheduleSlots = ((data as { starts_at: string }[]) ?? []).filter((s) => s.starts_at !== a.starts_at).slice(0, 80);
  }
  const canCancel = ["pending_payment", "pending_acceptance", "professional_assigned", "pending_reassignment", "confirmed"].includes(a.status);

  return (
    <>
      <PageHeader title={`Cita ${a.code}`} subtitle={`${a.specialty?.name ?? ""} · ${CARE_TYPE[a.care_type]}`}
        actions={<><StatusBadge map={APPOINTMENT_STATUS} value={a.status} /><span className="text-sm text-ink-soft">Pago: {PAYMENT_STATE[a.payment_state]}</span></>} />
      <Flash searchParams={sp} />

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Mensaje por estado */}
          {a.status === "pending_payment" && (
            <Card>
              <h2 className="font-display text-lg font-bold">Completa tu pago</h2>
              <p className="mt-1 text-sm text-ink-soft">El horario está reservado temporalmente hasta {formatDateTime(a.hold_expires_at)}. Si no pagas antes, se liberará.</p>
              {!isWompiConfigured() && <Notice kind="warning" className="mt-3">La pasarela de pagos no está configurada en este entorno.</Notice>}
              <form action={payAppointment} className="mt-4"><Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                <SubmitButton disabled={!isWompiConfigured()}>Pagar {formatCOP(a.total_amount)}</SubmitButton></form>
            </Card>
          )}
          {a.status === "payment_processing" && <Notice kind="warning" title="Pago en procesamiento">Estamos esperando la confirmación de la entidad financiera. Te avisaremos apenas se apruebe.</Notice>}
          {["pending_acceptance", "professional_assigned"].includes(a.status) && (
            <Notice kind="info" title="Esperando aceptación del profesional">
              El profesional tiene hasta las {formatDateTime(a.response_deadline)} para aceptar. Si no puede, te ofreceremos otro profesional o la devolución completa.
            </Notice>
          )}
          {a.status === "confirmed" && <Notice kind="success" title="Cita confirmada">El profesional aceptó tu cita. Te avisaremos cuando vaya en camino.</Notice>}
          {["en_route", "arrived", "in_progress"].includes(a.status) && <Notice kind="info" title={APPOINTMENT_STATUS[a.status].label}>Seguimiento en tiempo real de tu servicio.</Notice>}

          {a.status === "pending_reassignment" && (
            <Card>
              <h2 className="font-display text-lg font-bold">Elige cómo continuar</h2>
              <p className="mt-1 text-sm text-ink-soft">El profesional no pudo atender tu solicitud. Puedes elegir otro profesional disponible o pedir la devolución completa. Si no decides antes de {formatDateTime(a.reassignment_deadline)}, iniciaremos la devolución automáticamente.</p>
              <div className="mt-4 space-y-3">
                {alternatives.length ? alternatives.map((alt) => (
                  <form key={alt.professional_id + alt.starts_at} action={acceptAlternative} className="rounded-2xl border border-slate-100 p-4">
                    <Back to={here} />
                    <input type="hidden" name="appointment_id" value={id} />
                    <input type="hidden" name="professional_id" value={alt.professional_id} />
                    <input type="hidden" name="starts_at" value={alt.starts_at} />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">{alt.full_name} <span className="text-sm font-normal text-ink-soft">· {alt.specialty}</span></p>
                        <p className="text-sm text-ink-soft">{formatDateTime(alt.starts_at)} {alt.same_time ? "(mismo horario)" : "(otro horario)"}</p>
                        <p className="text-sm">Valor: <strong>{formatCOP(alt.total_amount)}</strong>{" "}
                          {Number(alt.price_difference) < 0 && <span className="text-teal-700">· te devolvemos {formatCOP(-alt.price_difference)}</span>}
                          {Number(alt.price_difference) > 0 && <span className="text-red-700">· cuesta {formatCOP(alt.price_difference)} más (no disponible aún)</span>}
                        </p>
                      </div>
                      <div className="space-y-2 text-right">
                        {Number(alt.total_amount) !== Number(a.total_amount) && Number(alt.price_difference) <= 0 && (
                          <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="accept_price" required /> Acepto el nuevo valor</label>
                        )}
                        <SubmitButton size="sm" disabled={Number(alt.price_difference) > 0}>Elegir</SubmitButton>
                      </div>
                    </div>
                  </form>
                )) : <p className="text-sm text-ink-soft">No encontramos profesionales alternativos disponibles en este momento.</p>}
              </div>
              <form action={requestRefundInstead} className="mt-5 border-t border-slate-100 pt-4">
                <Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                <SubmitButton variant="outline" confirm="¿Solicitar la devolución completa y cerrar esta cita?">Prefiero la devolución completa</SubmitButton>
              </form>
            </Card>
          )}

          {a.status === "completed" && (
            <Card>
              <h2 className="font-display text-lg font-bold">Servicio completado</h2>
              {!a.patient_confirmed_at ? (
                <form action={confirmCompletion} className="mt-3"><Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                  <p className="mb-3 text-sm text-ink-soft">¿Recibiste la atención? Confírmalo para cerrar el servicio.</p>
                  <SubmitButton>Sí, recibí la atención</SubmitButton></form>
              ) : <p className="mt-1 text-sm text-teal-700">Confirmaste la atención el {formatDateTime(a.patient_confirmed_at)}.</p>}
              {review ? (
                <p className="mt-4 text-sm">Tu calificación: {"★".repeat(review.rating)} {review.comment && `— ${review.comment}`}</p>
              ) : (
                <form action={submitReview} className="mt-5 grid gap-3 sm:grid-cols-[160px_1fr]">
                  <Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                  <Field label="Calificación"><Select name="rating" required defaultValue="5">{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} ({n})</option>)}</Select></Field>
                  <Field label="Comentario (opcional)"><Input name="comment" maxLength={1000} /></Field>
                  <div><SubmitButton variant="secondary">Calificar</SubmitButton></div>
                </form>
              )}
            </Card>
          )}

          {(a.status === "refund_pending" || refunds?.length) ? (
            <Card>
              <h2 className="font-display text-lg font-bold">Devoluciones</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {refunds?.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <span>{formatCOP(r.amount)} · {r.reason}</span>
                    <span className="flex items-center gap-2"><StatusBadge map={REFUND_STATUS} value={r.status} />{r.provider_reference && <span className="font-mono text-xs">Comp. {r.provider_reference}</span>}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {/* Desglose */}
          <Card>
            <h2 className="font-display text-lg font-bold">Detalle del servicio</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-ink-soft">Profesional</dt><dd className="font-semibold">{pro?.full_name ?? "Profesional asignado"}</dd></div>
              <div><dt className="text-ink-soft">Fecha y hora</dt><dd className="font-semibold">{formatDateTime(a.starts_at)} ({a.duration_min} min)</dd></div>
              <div className="sm:col-span-2"><dt className="text-ink-soft">Dirección</dt><dd className="font-semibold">{a.address_snapshot?.address_line} · {[a.address_snapshot?.neighborhood, a.address_snapshot?.area_name].filter(Boolean).join(", ")}</dd></div>
              {a.patient_notes && <div className="sm:col-span-2"><dt className="text-ink-soft">Motivo</dt><dd>{a.patient_notes}</dd></div>}
            </dl>
            <dl className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
              {breakdown.map((l, i) => <div key={i} className="flex justify-between py-2 text-sm"><dt className="text-ink-soft">{l.label}</dt><dd>{formatCOP(l.amount)}</dd></div>)}
              <div className="flex justify-between pt-3 font-bold"><dt>Total</dt><dd>{formatCOP(a.total_amount)}</dd></div>
            </dl>
            {approvedPayment && <Link href={`/paciente/comprobante/${approvedPayment.id}`} className={buttonClass({ variant: "outline", size: "sm", className: "mt-4" })}>Descargar comprobante</Link>}
          </Card>

          {canReschedule && (
            <Card>
              <h2 className="font-display text-lg font-bold">Reprogramar</h2>
              <p className="mt-1 text-sm text-ink-soft">Puedes reprogramar con al menos {freeH} horas de anticipación. El profesional deberá aceptar el nuevo horario.</p>
              <form action={rescheduleAppointment} className="mt-3 flex flex-wrap items-end gap-3">
                <Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                <Field label="Nuevo horario"><Select name="starts_at" required>{rescheduleSlots.map((s) => <option key={s.starts_at} value={s.starts_at}>{formatDateTime(s.starts_at)}</option>)}</Select></Field>
                <label className="flex items-center gap-2 pb-3 text-xs"><input type="checkbox" name="accept_price" /> Acepto si cambia el valor (p. ej. recargo nocturno)</label>
                <SubmitButton variant="outline" disabled={!rescheduleSlots.length}>Reprogramar</SubmitButton>
              </form>
            </Card>
          )}

          {canCancel && (
            <Card>
              <h2 className="font-display text-lg font-bold">Cancelar cita</h2>
              <p className="mt-1 text-sm text-ink-soft">
                {a.status === "confirmed" && hoursBefore < freeH
                  ? `Faltan menos de ${freeH} horas: se devolverá el ${latePct} % del valor pagado.`
                  : a.payment_state === "paid" ? "Recibirás la devolución completa del valor pagado." : "No se ha realizado ningún cobro."}
              </p>
              <form action={cancelAppointment} className="mt-3 flex flex-wrap items-end gap-3">
                <Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                <Field label="Motivo" className="min-w-[240px] flex-1"><Input name="reason" required /></Field>
                <SubmitButton variant="danger" confirm="¿Seguro que deseas cancelar esta cita?">Cancelar cita</SubmitButton>
              </form>
            </Card>
          )}

          {["confirmed", "en_route", "arrived", "in_progress", "completed"].includes(a.status) && (
            <details className="rounded-2xl border border-slate-100 bg-white p-5">
              <summary className="cursor-pointer font-semibold">¿Hubo un problema con el servicio?</summary>
              <form action={openDispute} className="mt-3 space-y-3">
                <Back to={here} /><input type="hidden" name="appointment_id" value={id} />
                <Field label="Describe lo ocurrido"><Textarea name="reason" required maxLength={1000} /></Field>
                <SubmitButton variant="outline">Abrir reclamo</SubmitButton>
              </form>
            </details>
          )}
        </div>

        <Card className="xl:self-start">
          <h2 className="font-display text-lg font-bold">Historial de estados</h2>
          <ol className="mt-4 space-y-4 border-l-2 border-slate-100 pl-4">
            {history?.map((h, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[23px] top-1 h-3 w-3 rounded-full bg-brand-500 ring-4 ring-white" />
                <p className="text-sm font-semibold">{APPOINTMENT_STATUS[h.to_status]?.label}</p>
                {h.reason && <p className="text-xs text-ink-soft">{h.reason}</p>}
                <p className="text-xs text-ink-faint">{formatDateTime(h.created_at)} · {h.actor_role === "system" ? "Sistema" : h.actor_role === "patient" ? "Tú" : h.actor_role === "professional" ? "Profesional" : "Administración"}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    </>
  );
}
