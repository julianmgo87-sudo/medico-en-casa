import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarCheck, CreditCard, Home, ShieldCheck, Stethoscope, UserCheck, Clock, Siren } from "lucide-react";
import { ButtonLink, Notice } from "@/components/ui";
import { CategoryIcon } from "@/components/CategoryIcon";
import { ProfessionalCard } from "@/components/ProfessionalCard";
import { getCatalog, getPublicSettings, type PublicProfessional } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { formatCOP } from "@/lib/format";

export const dynamic = "force-dynamic";

const STEPS = [
  { icon: UserCheck, title: "Crea tu cuenta", text: "Regístrate y activa tu membresía para acceder a las reservas." },
  { icon: Stethoscope, title: "Elige el servicio", text: "Selecciona el tipo de profesional, revisa perfiles verificados y horarios." },
  { icon: CalendarCheck, title: "Agenda fecha y dirección", text: "Escoge consulta programada o atención prioritaria y confirma tu dirección." },
  { icon: CreditCard, title: "Paga de forma segura", text: "Ves el precio total antes de pagar. Pagas el 100 % a Médico en Casa Palmira." },
  { icon: Clock, title: "El profesional acepta", text: "Recibes la confirmación. Si no puede, te ofrecemos otro profesional o la devolución." },
  { icon: Home, title: "Te atienden en casa", text: "Sigue el estado de tu cita y califica la atención al terminar." },
];

const BENEFITS = [
  { icon: BadgeCheck, title: "Profesionales verificados", text: "Revisamos títulos, registro profesional y RETHUS antes de habilitar cada perfil." },
  { icon: ShieldCheck, title: "Pagos protegidos", text: "Tu pago se procesa con una pasarela colombiana certificada. Si la cita no se presta, te devolvemos el dinero." },
  { icon: Clock, title: "Sin desplazamientos", text: "Ideal para adultos mayores, personas en recuperación o con movilidad reducida." },
  { icon: CalendarCheck, title: "Precios claros", text: "El valor total, con recargos y desplazamiento, se muestra antes de pagar. Sin sorpresas." },
];

export default async function HomePage() {
  const [catalog, settings] = await Promise.all([getCatalog(), getPublicSettings()]);
  let professionals: PublicProfessional[] = [];
  let plans: { id: string; name: string; description: string; price: number; duration_days: number }[] = [];
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const [p, m] = await Promise.all([
      supabase.from("public_professionals").select("*").order("rating_avg", { ascending: false }).limit(6),
      supabase.from("membership_plans").select("id, name, description, price, duration_days").eq("is_active", true).order("sort_order"),
    ]);
    professionals = (p.data as PublicProfessional[]) ?? [];
    plans = m.data ?? [];
  }
  const freeCancelHours = Number(settings.free_cancellation_hours ?? 24);

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_80%_-10%,#d9eaff_0%,transparent_60%),radial-gradient(40rem_24rem_at_0%_100%,#c8fff4_0%,transparent_60%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:pt-20 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-bold uppercase tracking-wider text-teal-700 ring-1 ring-teal-200">
              Palmira · Valle del Cauca
            </p>
            <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-6xl">
              Tu salud, en la comodidad de <span className="bg-gradient-to-r from-brand-700 to-teal-500 bg-clip-text text-transparent">tu hogar</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-soft">
              Agenda atención domiciliaria con profesionales de la salud verificados. Elige el servicio, el horario y paga de forma segura en un solo lugar.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink href="/reservar" size="lg">Agendar atención a domicilio <ArrowRight className="h-5 w-5" /></ButtonLink>
              <ButtonLink href="/servicios" size="lg" variant="outline">Ver servicios</ButtonLink>
            </div>
            <p className="mt-6 flex items-start gap-2 text-sm text-ink-soft">
              <Siren className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <span>La atención prioritaria es una visita domiciliaria agendada lo antes posible; <strong className="text-ink">no es un servicio de urgencias</strong>. Ante una emergencia vital llama al 123.</span>
            </p>
          </div>
          <div className="relative">
            <div className="rounded-3xl bg-gradient-to-br from-brand-700 to-teal-500 p-1 shadow-lift">
              <div className="rounded-[1.6rem] bg-white p-6">
                <p className="text-sm font-semibold text-ink-soft">Así se ve tu reserva</p>
                <div className="mt-4 space-y-3">
                  {[
                    ["Servicio", "Medicina general a domicilio"],
                    ["Tipo de atención", "Consulta programada"],
                    ["Dirección", "Verificamos cobertura en tu zona"],
                    ["Precio", "Desglose completo antes de pagar"],
                    ["Estado", "Pendiente de aceptación → Confirmada"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3 text-sm">
                      <span className="text-ink-soft">{k}</span><span className="text-right font-semibold text-ink">{v}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-4 text-xs text-ink-soft">El pago no garantiza la aceptación inmediata: el profesional confirma la cita. Si no puede atenderte, eliges otro profesional o recibes la devolución.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {!isSupabaseConfigured() && (
        <div className="mx-auto max-w-6xl px-4"><Notice kind="warning" title="Base de datos no configurada">Configura las variables de Supabase (ver README) para cargar servicios y profesionales.</Notice></div>
      )}

      {/* CATEGORÍAS */}
      <section className="mx-auto max-w-6xl px-4 py-14" aria-labelledby="servicios">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 id="servicios" className="font-display text-3xl font-bold tracking-tight">Servicios a domicilio</h2>
            <p className="mt-1 text-ink-soft">Cada servicio se habilita solo después de verificar sus requisitos para atención domiciliaria.</p>
          </div>
          <Link href="/servicios" className="hidden text-sm font-semibold text-brand-700 hover:underline sm:block">Ver todos →</Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {catalog.map((c) => (
            <Link key={c.id} href={`/servicios/${c.slug}`} className="group flex flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-card transition hover:-translate-y-0.5 hover:shadow-lift">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-700 group-hover:bg-brand-700 group-hover:text-white"><CategoryIcon name={c.icon} /></span>
              <h3 className="mt-4 font-display text-lg font-bold">{c.name}</h3>
              <p className="mt-1 text-sm text-ink-soft">{c.description}</p>
              <div className="mt-auto pt-4 text-sm">
                {c.booking_enabled ? (
                  <>
                    <p className="text-ink-soft">{c.professionals_count} profesional{c.professionals_count === 1 ? "" : "es"} disponible{c.professionals_count === 1 ? "" : "s"}</p>
                    {c.price_from ? <p className="font-semibold text-ink">Desde {formatCOP(c.price_from)}</p> : null}
                  </>
                ) : (
                  <p className="font-semibold text-amber-700">Próximamente</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* CÓMO FUNCIONA */}
      <section id="como-funciona" className="bg-slate-50 py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="font-display text-3xl font-bold tracking-tight">Cómo funciona</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl bg-white p-5 shadow-card">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-50 text-teal-700"><s.icon className="h-5 w-5" /></span>
                  <span className="text-xs font-bold uppercase tracking-wider text-ink-faint">Paso {i + 1}</span>
                </div>
                <h3 className="mt-3 font-semibold">{s.title}</h3>
                <p className="mt-1 text-sm text-ink-soft">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* PROFESIONALES */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <h2 className="font-display text-3xl font-bold tracking-tight">Profesionales disponibles</h2>
            <p className="mt-1 text-ink-soft">Perfiles revisados y aprobados por nuestro equipo.</p>
          </div>
          <Link href="/profesionales" className="hidden text-sm font-semibold text-brand-700 hover:underline sm:block">Ver directorio →</Link>
        </div>
        {professionals.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{professionals.map((p) => <ProfessionalCard key={p.id} p={p} />)}</div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center">
            <p className="font-semibold">Estamos verificando a nuestros primeros profesionales.</p>
            <p className="mt-1 text-sm text-ink-soft">¿Eres profesional de la salud en Palmira? <Link href="/auth/registro-profesional" className="font-semibold text-brand-700 hover:underline">Postúlate aquí</Link>.</p>
          </div>
        )}
      </section>

      {/* BENEFICIOS */}
      <section className="bg-gradient-to-br from-brand-800 to-brand-950 py-16 text-white">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="font-display text-3xl font-bold tracking-tight">Por qué Médico en Casa Palmira</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {BENEFITS.map((b) => (
              <div key={b.title} className="rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <b.icon className="h-7 w-7 text-teal-300" />
                <h3 className="mt-3 font-semibold">{b.title}</h3>
                <p className="mt-1 text-sm text-brand-100">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MEMBRESÍAS */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="font-display text-3xl font-bold tracking-tight">Membresía</h2>
        <p className="mt-1 max-w-2xl text-ink-soft">La membresía te da acceso al sistema de reservas. <strong className="text-ink">No incluye el valor de las consultas</strong>, que se pagan por separado según el servicio.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:max-w-3xl">
          {plans.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-100 bg-white p-6 shadow-card">
              <h3 className="font-display text-lg font-bold">{p.name}</h3>
              <p className="mt-1 text-sm text-ink-soft">{p.description}</p>
              <p className="mt-4 font-display text-3xl font-extrabold">{formatCOP(p.price)}</p>
              <p className="text-xs text-ink-soft">por {p.duration_days} días</p>
              <ButtonLink href="/membresias" className="mt-5 w-full" variant="outline">Ver detalles</ButtonLink>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-3xl px-4 py-10">
        <h2 className="font-display text-3xl font-bold tracking-tight">Preguntas frecuentes</h2>
        <div className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white shadow-card">
          {[
            ["¿Puedo ver los servicios sin pagar la membresía?", "Sí. El catálogo y los perfiles son públicos. Necesitas una membresía activa solo para solicitar citas."],
            ["¿El pago garantiza mi cita?", "No de inmediato. Tras el pago, el profesional tiene un tiempo límite para aceptar. Si rechaza o no responde, te ofrecemos otro profesional (con tu aprobación) o la devolución completa del valor de la consulta."],
            ["¿A quién le pago?", "Pagas el 100 % a Médico en Casa Palmira a través de la pasarela de pagos. Los profesionales no cobran directamente en la plataforma."],
            ["¿Qué pasa si cancelo?", `Si la cita aún no ha sido aceptada, la devolución es total. Si ya está confirmada y cancelas con al menos ${freeCancelHours} horas de anticipación, también es total. Las cancelaciones tardías se rigen por los términos y condiciones.`],
            ["¿Atienden emergencias?", "No. La plataforma no presta atención de urgencias ni emergencias vitales. En ese caso llama a la línea 123 o acude al servicio de urgencias más cercano."],
            ["¿Qué datos de salud guardan?", "Solo un motivo breve de la visita, opcional, para que el profesional se prepare. La historia clínica es responsabilidad del profesional o prestador que te atiende, conforme a la normativa colombiana."],
          ].map(([q, a]) => (
            <details key={q} className="group p-5">
              <summary className="flex cursor-pointer items-center justify-between gap-4 font-semibold">{q}<span className="text-brand-700 transition group-open:rotate-45">+</span></summary>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}
