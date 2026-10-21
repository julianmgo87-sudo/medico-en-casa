import { Back, Card, Field, Flash, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, bogotaDate, formatDate, formatDateTime, formatTime, WEEKDAYS } from "@/lib/format";
import { addAvailability, addException, removeAvailability, removeException } from "@/app/actions/professional";

export default async function AgendaPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireRole("professional");
  const supabase = await createClient();
  const today = bogotaDate();
  const [{ data: windows }, { data: exceptions }, { data: profile }, { data: slots }] = await Promise.all([
    supabase.from("professional_availability").select("*").eq("professional_id", user.id).order("weekday").order("start_time"),
    supabase.from("availability_exceptions").select("*").eq("professional_id", user.id).gte("ends_at", new Date().toISOString()).order("starts_at"),
    supabase.from("professional_profiles").select("status, default_duration_min, travel_buffer_min").eq("user_id", user.id).single(),
    supabase.rpc("get_available_slots", { p_prof: user.id, p_from: today, p_to: addDays(today, 6) }),
  ]);
  const preview = ((slots as { starts_at: string }[]) ?? []);
  const byDay = new Map<string, string[]>();
  preview.forEach((s) => { const d = bogotaDate(new Date(s.starts_at)); byDay.set(d, [...(byDay.get(d) ?? []), s.starts_at]); });

  return (
    <>
      <PageHeader title="Agenda y disponibilidad" subtitle={`Duración de cita: ${profile?.default_duration_min} min · Tiempo de desplazamiento entre citas: ${profile?.travel_buffer_min} min (edítalos en tu perfil).`} />
      <Flash searchParams={sp} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <h2 className="font-display text-lg font-bold">Horario semanal recurrente</h2>
          <p className="mt-1 text-sm text-ink-soft">Agrega varias franjas en un mismo día para definir descansos (p. ej. 8:00–12:00 y 14:00–18:00).</p>
          <ul className="mt-4 divide-y divide-slate-100">
            {windows?.map((w) => (
              <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                <span><strong>{WEEKDAYS[w.weekday]}</strong> {w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}{w.valid_until ? ` (hasta ${formatDate(w.valid_until)})` : ""}</span>
                <form action={removeAvailability}><Back to="/profesional/agenda" /><input type="hidden" name="id" value={w.id} /><button className="text-xs font-semibold text-red-700">Eliminar</button></form>
              </li>
            ))}
            {!windows?.length && <li className="py-2 text-sm text-ink-soft">Aún no tienes horarios.</li>}
          </ul>
          <form action={addAvailability} className="mt-5 space-y-3 border-t border-slate-100 pt-5">
            <Back to="/profesional/agenda" />
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Días</legend>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-sm has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50">
                    <input type="checkbox" name="weekday" value={d} className="h-3.5 w-3.5" />{WEEKDAYS[d].slice(0, 3)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Desde"><Input type="time" name="start_time" required defaultValue="08:00" /></Field>
              <Field label="Hasta"><Input type="time" name="end_time" required defaultValue="12:00" /></Field>
              <Field label="Vigente desde"><Input type="date" name="valid_from" defaultValue={today} /></Field>
              <Field label="Vigente hasta (opcional)"><Input type="date" name="valid_until" /></Field>
            </div>
            <SubmitButton>Agregar franja</SubmitButton>
          </form>
        </Card>
        <div className="space-y-6">
          <Card>
            <h2 className="font-display text-lg font-bold">Bloquear fechas</h2>
            <ul className="mt-3 divide-y divide-slate-100">
              {exceptions?.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{formatDateTime(e.starts_at)} → {formatDateTime(e.ends_at)}{e.reason ? ` · ${e.reason}` : ""}</span>
                  <form action={removeException}><Back to="/profesional/agenda" /><input type="hidden" name="id" value={e.id} /><button className="text-xs font-semibold text-red-700">Quitar</button></form>
                </li>
              ))}
              {!exceptions?.length && <li className="py-2 text-sm text-ink-soft">Sin bloqueos.</li>}
            </ul>
            <form action={addException} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
              <Back to="/profesional/agenda" />
              <Field label="Desde"><Input type="datetime-local" name="starts_at" required /></Field>
              <Field label="Hasta"><Input type="datetime-local" name="ends_at" required /></Field>
              <Field label="Motivo (opcional)" className="sm:col-span-2"><Input name="reason" placeholder="Vacaciones, capacitación…" /></Field>
              <div><SubmitButton variant="outline">Bloquear</SubmitButton></div>
            </form>
          </Card>
          <Card>
            <h2 className="font-display text-lg font-bold">Vista previa: horarios que verán los pacientes</h2>
            {profile?.status !== "approved" && <p className="mt-1 text-sm text-amber-700">Tu perfil aún no está aprobado; los pacientes no ven horarios.</p>}
            <div className="mt-3 space-y-2 text-sm">
              {[...byDay.entries()].map(([d, list]) => (
                <p key={d}><strong>{formatDate(d, { weekday: "short", day: "numeric", month: "short" })}:</strong> {list.slice(0, 12).map((s) => formatTime(s)).join(" · ")}{list.length > 12 ? " …" : ""}</p>
              ))}
              {!byDay.size && <p className="text-ink-soft">No hay horarios disponibles en los próximos 7 días.</p>}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
