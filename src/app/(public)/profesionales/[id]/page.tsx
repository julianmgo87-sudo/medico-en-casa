import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, GraduationCap, MapPin, Star } from "lucide-react";
import { Avatar } from "@/components/ProfessionalCard";
import { Card, EmptyState, Notice, buttonClass, cx } from "@/components/ui";
import type { PublicProfessional } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { addDays, bogotaDate, formatCOP, formatDate, formatTime, WEEKDAYS } from "@/lib/format";
import { CREDENTIAL_TYPES } from "@/lib/status";

export const dynamic = "force-dynamic";

export default async function PerfilProfesionalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dia?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("public_professionals").select("*").eq("id", id).maybeSingle();
  const p = data as PublicProfessional | null;
  if (!p) notFound();

  const today = bogotaDate();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const selected = sp.dia && days.includes(sp.dia) ? sp.dia : today;
  const [{ data: slotsWeek }, { data: reviews }, { data: windows }] = await Promise.all([
    supabase.rpc("get_available_slots", { p_prof: id, p_from: today, p_to: addDays(today, 6) }),
    supabase.from("public_reviews").select("*").eq("professional_id", id).order("created_at", { ascending: false }).limit(10),
    supabase.from("professional_availability").select("weekday, start_time, end_time").eq("professional_id", id).eq("is_active", true).order("weekday").order("start_time"),
  ]);
  const slots = (slotsWeek as { starts_at: string; ends_at: string }[] | null) ?? [];
  const byDay = new Map<string, typeof slots>();
  for (const s of slots) {
    const d = bogotaDate(new Date(s.starts_at));
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const daySlots = byDay.get(selected) ?? [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/profesionales" className="text-sm font-semibold text-brand-700 hover:underline">← Directorio</Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Card className="flex flex-col gap-5 sm:flex-row">
            <Avatar name={p.full_name} path={p.photo_path} className="h-28 w-28" />
            <div>
              <h1 className="font-display text-3xl font-bold">{p.full_name}</h1>
              <p className="text-ink-soft">{p.profession} · {p.specialty_name}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-sm">
                {p.rethus_verified && <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-3 py-1 font-semibold text-teal-800"><BadgeCheck className="h-4 w-4" /> Registro RETHUS verificado</span>}
                {p.rating_count > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {Number(p.rating_avg).toFixed(1)} · {p.rating_count} valoraciones</span>}
                {p.years_experience ? <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">{p.years_experience} años de experiencia</span> : null}
              </div>
            </div>
          </Card>

          {p.bio && <Card><h2 className="font-display text-lg font-bold">Perfil profesional</h2><p className="mt-2 whitespace-pre-line leading-relaxed text-ink-soft">{p.bio}</p></Card>}

          <Card>
            <h2 className="font-display text-lg font-bold">Credenciales verificadas</h2>
            {p.credentials.length ? (
              <ul className="mt-3 space-y-3">
                {p.credentials.map((c, i) => (
                  <li key={i} className="flex gap-3">
                    <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-brand-700" />
                    <div><p className="font-semibold">{c.title}</p><p className="text-sm text-ink-soft">{CREDENTIAL_TYPES[c.type] ?? c.type}{c.institution ? ` · ${c.institution}` : ""}{c.year ? ` · ${c.year}` : ""}</p></div>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-ink-soft">Sin credenciales públicas.</p>}
            <p className="mt-4 text-xs text-ink-soft">Los documentos de soporte fueron revisados por el equipo de la plataforma y no se publican.</p>
          </Card>

          <Card>
            <h2 className="font-display text-lg font-bold">Zonas atendidas</h2>
            <p className="mt-2 flex items-start gap-2 text-ink-soft"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {p.zones.join(", ") || "—"}</p>
            {windows && windows.length > 0 && (
              <>
                <h3 className="mt-5 font-semibold">Horario habitual</h3>
                <ul className="mt-2 grid gap-1 text-sm text-ink-soft sm:grid-cols-2">
                  {windows.map((w, i) => <li key={i}>{WEEKDAYS[w.weekday]}: {w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}</li>)}
                </ul>
              </>
            )}
          </Card>

          <Card>
            <h2 className="font-display text-lg font-bold">Valoraciones</h2>
            {reviews?.length ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {reviews.map((r) => (
                  <li key={r.id} className="py-3">
                    <p className="text-sm font-semibold">{"★".repeat(r.rating)}<span className="text-slate-300">{"★".repeat(5 - r.rating)}</span> · {r.patient_first_name}</p>
                    {r.comment && <p className="mt-1 text-sm text-ink-soft">{r.comment}</p>}
                    <p className="mt-1 text-xs text-ink-faint">{formatDate(r.created_at)}</p>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-ink-soft">Aún no tiene valoraciones.</p>}
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card>
            <p className="text-sm text-ink-soft">Consulta de {p.default_duration_min} min desde</p>
            <p className="font-display text-3xl font-extrabold">{formatCOP(p.price_from)}</p>
            <p className="mt-1 text-xs text-ink-soft">Tarifa base. Pueden aplicar recargos (nocturno, fin de semana, festivo, prioritaria) y desplazamiento según tu zona. Verás el total antes de pagar.</p>

            <h2 className="mt-6 font-semibold">Disponibilidad</h2>
            <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
              {days.map((d) => {
                const count = byDay.get(d)?.length ?? 0;
                const date = new Date(d + "T12:00:00-05:00");
                return (
                  <Link key={d} href={`?dia=${d}`} scroll={false}
                    className={cx("flex min-w-[56px] flex-col items-center rounded-xl border px-2 py-2 text-xs", d === selected ? "border-brand-700 bg-brand-700 text-white" : "border-slate-200 hover:border-brand-300", count === 0 && d !== selected && "opacity-50")}>
                    <span className="font-semibold uppercase">{WEEKDAYS[date.getUTCDay()].slice(0, 3)}</span>
                    <span className="text-base font-bold">{d.slice(8)}</span>
                    <span>{count}</span>
                  </Link>
                );
              })}
            </div>
            <div className="mt-4">
              {!p.booking_enabled ? (
                <Notice kind="warning">Este servicio aún no está habilitado para reservas.</Notice>
              ) : daySlots.length ? (
                <div className="grid grid-cols-3 gap-2">
                  {daySlots.map((s) => (
                    <Link key={s.starts_at} href={`/reservar?profesional=${p.id}&inicio=${encodeURIComponent(s.starts_at)}`}
                      className="rounded-xl border border-brand-200 py-2 text-center text-sm font-semibold text-brand-800 hover:bg-brand-50">
                      {formatTime(s.starts_at)}
                    </Link>
                  ))}
                </div>
              ) : (
                <EmptyState title="Sin horarios este día" />
              )}
            </div>
            {p.booking_enabled && <Link href={`/reservar?profesional=${p.id}`} className={buttonClass({ className: "mt-5 w-full", size: "lg" })}>Agendar cita</Link>}
          </Card>
        </aside>
      </div>
    </div>
  );
}
