import Link from "next/link";
import type { Metadata } from "next";
import { CalendarClock, Check, MapPin, Siren, Zap } from "lucide-react";
import { Back, Card, EmptyState, Field, Flash, Input, Notice, Select, Textarea, buttonClass, cx } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Avatar } from "@/components/ProfessionalCard";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getPublicSettings, settingNumber, type PublicProfessional } from "@/lib/data";
import { addDays, bogotaDate, formatCOP, formatDate, formatDateTime, formatTime, WEEKDAYS } from "@/lib/format";
import { CARE_TYPE } from "@/lib/status";
import { isWompiConfigured } from "@/lib/wompi";
import { addAddress, createBookingAndPay } from "@/app/actions/booking";

export const metadata: Metadata = { title: "Reservar atención a domicilio" };
export const dynamic = "force-dynamic";

type SP = { servicio?: string; profesional?: string; tipo?: string; duracion?: string; dia?: string; inicio?: string; direccion?: string; promo?: string; ok?: string; error?: string };
const KEYS: (keyof SP)[] = ["servicio", "profesional", "tipo", "duracion", "dia", "inicio", "direccion", "promo"];

function href(sp: SP, changes: Partial<Record<keyof SP, string | null>>) {
  const p = new URLSearchParams();
  for (const k of KEYS) {
    const v = k in changes ? changes[k] : sp[k];
    if (v) p.set(k, v);
  }
  return `/reservar?${p.toString()}`;
}

const STEPS = ["Servicio", "Profesional", "Tipo de atención", "Fecha y hora", "Dirección", "Resumen y pago"];

export default async function ReservarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const user = await requireRole("patient");
  const supabase = await createClient();
  const [catalog, settings] = await Promise.all([getCatalog(), getPublicSettings()]);
  const bookable = catalog.filter((c) => c.booking_enabled && c.professionals_count > 0);

  // Resolver selección
  let pro: PublicProfessional | null = null;
  if (sp.profesional && sp.profesional !== "auto") {
    const { data } = await supabase.from("public_professionals").select("*").eq("id", sp.profesional).maybeSingle();
    pro = data as PublicProfessional | null;
    if (pro && !sp.servicio) sp.servicio = pro.category_slug;
  }
  const category = catalog.find((c) => c.slug === sp.servicio) ?? null;
  const care = sp.tipo === "priority" ? "priority" : sp.tipo === "scheduled" ? "scheduled" : null;
  const duration = Number(sp.duracion) || pro?.default_duration_min || 60;

  const [{ data: membership }, { data: addresses }] = await Promise.all([
    supabase.from("patient_memberships").select("id").eq("patient_id", user.id).eq("status", "active").gt("ends_at", new Date().toISOString()).limit(1),
    supabase.from("patient_addresses").select("id, label, address_line, neighborhood, service_area_id, area:service_areas(name)").eq("patient_id", user.id).eq("is_archived", false).order("is_default", { ascending: false }),
  ]);
  const membershipRequired = settings.membership_required !== false;
  const hasMembership = (membership?.length ?? 0) > 0;

  let step = 0;
  if (category) step = 1;
  if (step === 1 && (pro || sp.profesional === "auto")) step = 2;
  if (step === 2 && care) step = 3;
  if (step === 3 && sp.inicio && pro) step = 4;
  if (step === 4 && sp.direccion) step = 5;

  const summary: [string, string, string][] = [];
  if (category) summary.push(["Servicio", category.name, href(sp, { servicio: null, profesional: null, tipo: null, inicio: null, dia: null })]);
  if (step >= 2) summary.push(["Profesional", pro ? pro.full_name : "El primero disponible", href(sp, { profesional: null, inicio: null, dia: null })]);
  if (step >= 3 && care) summary.push(["Tipo", `${CARE_TYPE[care]} · ${duration} min`, href(sp, { tipo: null, inicio: null, dia: null })]);
  if (step >= 4 && sp.inicio) summary.push(["Fecha y hora", formatDateTime(sp.inicio), href(sp, { inicio: null })]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="font-display text-3xl font-bold">Agendar atención a domicilio</h1>
      <ol className="mt-6 flex gap-2 overflow-x-auto pb-2 text-xs font-semibold">
        {STEPS.map((s, i) => (
          <li key={s} className={cx("flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5", i < step ? "bg-teal-50 text-teal-800" : i === step ? "bg-brand-700 text-white" : "bg-slate-100 text-ink-soft")}>
            {i < step ? <Check className="h-3.5 w-3.5" /> : <span>{i + 1}</span>} {s}
          </li>
        ))}
      </ol>
      <div className="mt-6"><Flash searchParams={sp} /></div>
      {membershipRequired && !hasMembership && (
        <Notice kind="warning" className="mb-6" title="Necesitas una membresía activa para solicitar citas">
          Puedes explorar horarios y precios, pero para confirmar la reserva debes <Link href="/membresias" className="font-semibold underline">activar tu membresía</Link>.
        </Notice>
      )}

      {summary.length > 0 && (
        <Card className="mb-6 !p-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {summary.map(([k, v, h]) => (
              <div key={k} className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                <div><dt className="text-xs text-ink-soft">{k}</dt><dd className="font-semibold">{v}</dd></div>
                <Link href={h} className="text-xs font-semibold text-brand-700 hover:underline">Cambiar</Link>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {/* PASO 1 — servicio */}
      {step === 0 && (
        bookable.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {bookable.map((c) => (
              <Link key={c.id} href={href(sp, { servicio: c.slug })} className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-card hover:border-brand-300">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><CategoryIcon name={c.icon} /></span>
                <div><p className="font-display text-lg font-bold">{c.name}</p><p className="text-sm text-ink-soft">{c.price_from ? `Desde ${formatCOP(c.price_from)}` : ""}</p></div>
              </Link>
            ))}
          </div>
        ) : <EmptyState title="Aún no hay servicios habilitados para reserva.">Estamos verificando profesionales y requisitos. Vuelve pronto.</EmptyState>
      )}

      {/* PASO 2 — profesional */}
      {step === 1 && category && <ProfessionalStep sp={sp} categorySlug={category.slug} />}

      {/* PASO 3 — tipo de atención */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Link href={href(sp, { tipo: "scheduled" })} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card hover:border-brand-300">
              <CalendarClock className="h-7 w-7 text-brand-700" />
              <p className="mt-3 font-display text-lg font-bold">Consulta programada</p>
              <p className="mt-1 text-sm text-ink-soft">Elige fecha y hora con al menos {Math.round(settingNumber(settings, "scheduled_min_lead_min", 120) / 60)} horas de anticipación. El profesional responde en máximo {settingNumber(settings, "response_timeout_scheduled_min", 30)} minutos.</p>
            </Link>
            <Link href={href(sp, { tipo: "priority", inicio: null })} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card hover:border-brand-300">
              <Zap className="h-7 w-7 text-teal-600" />
              <p className="mt-3 font-display text-lg font-bold">Atención prioritaria a domicilio</p>
              <p className="mt-1 text-sm text-ink-soft">Horarios disponibles en las próximas {settingNumber(settings, "priority_window_hours", 8)} horas, con recargo. Respuesta en máximo {settingNumber(settings, "response_timeout_priority_min", 15)} minutos.</p>
            </Link>
          </div>
          <Notice kind="error" title="Esto no es un servicio de urgencias">
            <span className="inline-flex items-start gap-2"><Siren className="mt-0.5 h-4 w-4 shrink-0" />Si hay dificultad para respirar, dolor en el pecho, pérdida de conciencia, sangrado abundante u otra emergencia, llama ya a la línea 123 o acude a urgencias.</span>
          </Notice>
          {pro && (
            <form method="get" action="/reservar" className="flex flex-wrap items-end gap-3">
              {KEYS.filter((k) => sp[k] && k !== "duracion").map((k) => <input key={k} type="hidden" name={k} value={sp[k]} />)}
              <Field label="Duración de la atención">
                <Select name="duracion" defaultValue={String(duration)}>
                  {[...new Set([pro.default_duration_min, 30, 60, 90])].sort((a, b) => a - b).map((d) => <option key={d} value={d}>{d} minutos{d === pro!.default_duration_min ? " (recomendada)" : ""}</option>)}
                </Select>
              </Field>
              <button className={buttonClass({ variant: "outline" })}>Aplicar</button>
            </form>
          )}
        </div>
      )}

      {/* PASO 4-5 — fecha y hora */}
      {step === 3 && care && <SlotStep sp={sp} pro={pro} care={care} duration={duration} categoryId={category!.id} />}

      {/* PASO 6 — dirección */}
      {step === 4 && pro && (
        <AddressStep sp={sp} proId={pro.id} addresses={(addresses ?? []).map((a) => ({ ...a, area_name: (Array.isArray(a.area) ? a.area[0] : a.area)?.name ?? "" }))} />
      )}

      {/* PASO 7-8 — resumen y pago */}
      {step === 5 && pro && care && sp.inicio && sp.direccion && (
        <SummaryStep sp={sp} pro={pro} care={care} duration={duration} canBook={!membershipRequired || hasMembership}
          address={(addresses ?? []).find((a) => a.id === sp.direccion)} />
      )}
    </div>
  );
}

async function ProfessionalStep({ sp, categorySlug }: { sp: SP; categorySlug: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("public_professionals").select("*").eq("category_slug", categorySlug).order("rating_avg", { ascending: false });
  const pros = (data as PublicProfessional[]) ?? [];
  return (
    <div className="space-y-3">
      <Link href={href(sp, { profesional: "auto" })} className="flex items-center justify-between gap-4 rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50/50 p-5 hover:bg-teal-50">
        <div><p className="font-display text-lg font-bold text-teal-900">El primero disponible</p><p className="text-sm text-teal-800">Te mostramos los horarios más próximos entre todos los profesionales.</p></div>
        <Zap className="h-6 w-6 text-teal-600" />
      </Link>
      {pros.map((p) => (
        <Link key={p.id} href={href(sp, { profesional: p.id })} className="flex items-center gap-4 rounded-2xl border border-slate-100 bg-white p-4 shadow-card hover:border-brand-300">
          <Avatar name={p.full_name} path={p.photo_path} className="h-14 w-14" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{p.full_name}</p>
            <p className="text-sm text-ink-soft">{p.specialty_name}{p.rating_count ? ` · ★ ${Number(p.rating_avg).toFixed(1)}` : ""}</p>
          </div>
          <p className="text-right text-sm"><span className="block text-xs text-ink-soft">desde</span><span className="font-bold">{formatCOP(p.price_from)}</span></p>
        </Link>
      ))}
    </div>
  );
}

async function SlotStep({ sp, pro, care, duration, categoryId }: { sp: SP; pro: PublicProfessional | null; care: "scheduled" | "priority"; duration: number; categoryId: string }) {
  const supabase = await createClient();
  const today = bogotaDate();
  const days = care === "priority" ? [today, addDays(today, 1)] : Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const day = sp.dia && days.includes(sp.dia) ? sp.dia : days[0];

  let slots: { starts_at: string; professional_id: string; name?: string }[] = [];
  if (pro) {
    const { data } = await supabase.rpc("get_available_slots", { p_prof: pro.id, p_from: day, p_to: care === "priority" ? addDays(day, 1) : day, p_care: care, p_duration_min: duration });
    slots = ((data as { starts_at: string }[]) ?? []).map((s) => ({ starts_at: s.starts_at, professional_id: pro.id }));
  } else {
    const { data } = await supabase.rpc("find_first_available", { p_category: categoryId, p_specialty: null, p_care: care, p_area: null, p_from: day, p_to: care === "priority" ? addDays(day, 1) : day });
    const rows = (data as { professional_id: string; starts_at: string }[]) ?? [];
    const ids = [...new Set(rows.map((r) => r.professional_id))];
    const { data: names } = ids.length ? await supabase.from("public_professionals").select("id, full_name").in("id", ids) : { data: [] };
    slots = rows.map((r) => ({ ...r, name: names?.find((n) => n.id === r.professional_id)?.full_name }));
  }

  return (
    <div>
      {care === "scheduled" && (
        <div className="flex gap-1.5 overflow-x-auto pb-2">
          {days.map((d) => {
            const date = new Date(d + "T12:00:00-05:00");
            return (
              <Link key={d} href={href(sp, { dia: d })} scroll={false} className={cx("flex min-w-[64px] flex-col items-center rounded-xl border px-2 py-2 text-xs", d === day ? "border-brand-700 bg-brand-700 text-white" : "border-slate-200 bg-white hover:border-brand-300")}>
                <span className="font-semibold uppercase">{WEEKDAYS[date.getUTCDay()].slice(0, 3)}</span>
                <span className="text-lg font-bold">{d.slice(8)}</span>
              </Link>
            );
          })}
        </div>
      )}
      <p className="mt-3 text-sm text-ink-soft">{care === "priority" ? "Horarios prioritarios disponibles:" : `Horarios del ${formatDate(day, { weekday: "long", day: "numeric", month: "long" })}:`}</p>
      {slots.length ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {slots.map((s) => (
            <Link key={s.professional_id + s.starts_at} href={href(sp, { profesional: s.professional_id, inicio: s.starts_at })}
              className="rounded-xl border border-brand-200 bg-white px-3 py-2.5 text-center hover:bg-brand-50">
              <span className="block font-semibold text-brand-800">{care === "priority" ? formatDateTime(s.starts_at) : formatTime(s.starts_at)}</span>
              {s.name && <span className="block truncate text-xs text-ink-soft">{s.name}</span>}
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-3"><EmptyState title="No hay horarios disponibles.">{care === "scheduled" ? "Prueba otro día u otro profesional." : "No hay disponibilidad prioritaria en este momento. Puedes agendar una consulta programada."}</EmptyState></div>
      )}
    </div>
  );
}

async function AddressStep({ sp, proId, addresses }: { sp: SP; proId: string; addresses: { id: string; label: string; address_line: string; neighborhood: string | null; service_area_id: string | null; area_name: string }[] }) {
  const supabase = await createClient();
  const [{ data: areas }, coverage] = await Promise.all([
    supabase.from("service_areas").select("id, name, area_type, parent_id").eq("is_active", true).order("area_type").order("name"),
    Promise.all(addresses.map((a) => a.service_area_id ? supabase.rpc("professional_covers_area", { p_prof: proId, p_area: a.service_area_id }) : Promise.resolve({ data: false }))),
  ]);
  return (
    <div className="space-y-4">
      {addresses.length > 0 && (
        <div className="space-y-2">
          {addresses.map((a, i) => {
            const covered = coverage[i]?.data === true;
            return covered ? (
              <Link key={a.id} href={href(sp, { direccion: a.id })} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-card hover:border-brand-300">
                <MapPin className="h-5 w-5 text-brand-700" />
                <div className="flex-1"><p className="font-semibold">{a.label}: {a.address_line}</p><p className="text-sm text-ink-soft">{[a.neighborhood, a.area_name].filter(Boolean).join(" · ")}</p></div>
                <span className="text-sm font-semibold text-brand-700">Usar</span>
              </Link>
            ) : (
              <div key={a.id} className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4 opacity-80">
                <MapPin className="h-5 w-5 text-ink-faint" />
                <div className="flex-1"><p className="font-semibold">{a.label}: {a.address_line}</p><p className="text-sm text-red-700">Sin cobertura del profesional en {a.area_name || "esta zona"}.</p></div>
              </div>
            );
          })}
        </div>
      )}
      <Card>
        <h2 className="font-semibold">Agregar una dirección</h2>
        <form action={addAddress} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Back to={href(sp, {})} />
          <Field label="Nombre"><Input name="label" placeholder="Casa, trabajo, casa de mamá…" /></Field>
          <Field label="Comuna / corregimiento / barrio">
            <Select name="service_area_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {areas?.filter((a) => a.area_type !== "municipio").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </Field>
          <Field label="Dirección" className="sm:col-span-2"><Input name="address_line" required placeholder="Calle 30 # 28-15, apto 302" /></Field>
          <Field label="Barrio"><Input name="neighborhood" /></Field>
          <Field label="Indicaciones"><Input name="reference_notes" placeholder="Casa esquinera, portón azul…" /></Field>
          <div className="sm:col-span-2"><SubmitButton>Guardar dirección</SubmitButton></div>
        </form>
        <p className="mt-3 text-xs text-ink-soft">¿Tu zona no aparece? Por ahora solo atendemos las zonas listadas en Palmira.</p>
      </Card>
    </div>
  );
}

type Quote = { lines: { label: string; amount: number }[]; total_amount: number; discount_label: string | null };

async function SummaryStep({ sp, pro, care, duration, canBook, address }: { sp: SP; pro: PublicProfessional; care: "scheduled" | "priority"; duration: number; canBook: boolean; address?: { id: string; label: string; address_line: string; service_area_id: string | null } }) {
  const supabase = await createClient();
  if (!address?.service_area_id) return <Notice kind="error">Dirección inválida. <Link className="underline" href={href(sp, { direccion: null })}>Elegir otra</Link></Notice>;
  const [{ data: quote, error }, { data: covered }, { data: free }] = await Promise.all([
    supabase.rpc("get_price_quote", { p_prof: pro.id, p_care: care, p_starts_at: sp.inicio, p_duration_min: duration, p_area: address.service_area_id, p_promo: sp.promo ?? null }),
    supabase.rpc("professional_covers_area", { p_prof: pro.id, p_area: address.service_area_id }),
    supabase.rpc("slot_is_available", { p_prof: pro.id, p_start: sp.inicio, p_duration_min: duration, p_care: care }),
  ]);
  const q = quote as Quote | null;
  const gateway = isWompiConfigured();
  if (!covered) return <Notice kind="error" title="Sin cobertura">El profesional no atiende la zona de esta dirección. <Link className="underline" href={href(sp, { direccion: null })}>Elegir otra dirección</Link> o <Link className="underline" href={href(sp, { profesional: null, inicio: null })}>otro profesional</Link>.</Notice>;
  if (free === false) return <Notice kind="error" title="El horario ya no está disponible">Alguien acaba de reservarlo. <Link className="underline" href={href(sp, { inicio: null })}>Elige otro horario</Link>.</Notice>;
  if (error || !q) return <Notice kind="error">No fue posible calcular el precio.</Notice>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <Card>
        <h2 className="font-display text-xl font-bold">Resumen de precio</h2>
        <p className="mt-1 text-sm text-ink-soft">{pro.full_name} · {formatDateTime(sp.inicio!)} · {address.label}: {address.address_line}</p>
        <dl className="mt-5 divide-y divide-slate-100">
          {q.lines.map((l, i) => (
            <div key={i} className="flex justify-between gap-4 py-2.5 text-sm"><dt className="text-ink-soft">{l.label}</dt><dd className={cx("font-semibold", l.amount < 0 && "text-teal-700")}>{formatCOP(l.amount)}</dd></div>
          ))}
          <div className="flex justify-between gap-4 pt-4"><dt className="font-display text-lg font-bold">Total a pagar</dt><dd className="font-display text-2xl font-extrabold">{formatCOP(q.total_amount)}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-ink-soft">Valor en pesos colombianos (COP). Este precio queda fijo para tu reserva.</p>
        <form method="get" action="/reservar" className="mt-5 flex flex-wrap items-end gap-2">
          {KEYS.filter((k) => sp[k] && k !== "promo").map((k) => <input key={k} type="hidden" name={k} value={sp[k]} />)}
          <Field label="Código promocional"><Input name="promo" defaultValue={sp.promo} className="w-48" /></Field>
          <button className={buttonClass({ variant: "outline" })}>Aplicar</button>
          {sp.promo && !q.discount_label && <p className="w-full text-xs text-red-700">El código no es válido o no aplica a este servicio.</p>}
        </form>
      </Card>
      <Card>
        <form action={createBookingAndPay} className="space-y-4">
          <Back to={href(sp, {})} />
          <input type="hidden" name="professional_id" value={pro.id} />
          <input type="hidden" name="care_type" value={care} />
          <input type="hidden" name="starts_at" value={sp.inicio} />
          <input type="hidden" name="duration_min" value={duration} />
          <input type="hidden" name="address_id" value={address.id} />
          <input type="hidden" name="promo_code" value={sp.promo ?? ""} />
          <Field label="Motivo breve de la visita (opcional)" hint="No incluyas historia clínica ni resultados de exámenes. Solo lo necesario para que el profesional se prepare.">
            <Textarea name="patient_notes" maxLength={500} placeholder="Ej.: control de presión arterial para adulto mayor" />
          </Field>
          <Notice kind="info">El pago no garantiza la aceptación inmediata. El profesional tiene un tiempo límite para aceptar; si no puede, eliges otro profesional o recibes la devolución completa.</Notice>
          <label className="flex gap-3 text-sm"><input type="checkbox" name="ack" required className="mt-1 h-4 w-4" /><span>Entiendo que mi reserva queda pendiente de aceptación del profesional y acepto los <Link href="/terminos" target="_blank" className="font-semibold text-brand-700 underline">términos</Link>.</span></label>
          {!gateway && <Notice kind="warning">La pasarela de pagos no está configurada en este entorno; no es posible pagar todavía.</Notice>}
          {!canBook && <Notice kind="warning">Activa tu <Link href="/membresias" className="font-semibold underline">membresía</Link> para continuar.</Notice>}
          <SubmitButton size="lg" className="w-full" disabled={!gateway || !canBook} pendingText="Reservando horario…">Pagar {formatCOP(q.total_amount)}</SubmitButton>
          <p className="text-center text-xs text-ink-soft">Serás redirigido a Wompi. Al iniciar el pago, el horario se reserva temporalmente.</p>
        </form>
      </Card>
    </div>
  );
}
