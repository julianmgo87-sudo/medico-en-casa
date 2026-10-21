import Link from "next/link";
import { Card, Flash, Notice, PageHeader, buttonClass } from "@/components/ui";
import { NotificationsCard } from "@/components/Notifications";
import { AppointmentRow, type ApptListItem } from "@/components/AppointmentRow";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

export default async function PacienteHome({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = await requireRole("patient");
  const supabase = await createClient();
  const [{ data: memberships }, { data: active }] = await Promise.all([
    supabase.from("patient_memberships").select("id, status, starts_at, ends_at, source, plan:membership_plans(name)").eq("patient_id", user.id).eq("status", "active").order("ends_at", { ascending: false }),
    supabase.from("appointments").select("id, code, status, care_type, starts_at, total_amount, specialty:specialties(name)")
      .eq("patient_id", user.id).not("status", "in", "(completed,cancelled,refunded,expired)").order("starts_at").limit(10),
  ]);
  const current = memberships?.find((m) => new Date(m.ends_at) > new Date());
  return (
    <>
      <PageHeader title={`Hola, ${user.full_name.split(" ")[0] || "paciente"}`} subtitle="Gestiona tus citas, pagos y membresía." actions={<Link href="/reservar" className={buttonClass()}>Agendar atención</Link>} />
      <Flash searchParams={sp} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {current ? (
            <Notice kind="success" title="Membresía activa">Vigente hasta el {formatDate(current.ends_at)}.{memberships && memberships.length > 1 ? " Tienes una renovación programada." : ""}</Notice>
          ) : (
            <Notice kind="warning" title="No tienes membresía activa">Para solicitar citas necesitas una membresía. <Link href="/membresias" className="font-semibold underline">Activarla</Link></Notice>
          )}
          <Card>
            <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold">Citas en curso</h2><Link href="/paciente/citas" className="text-sm font-semibold text-brand-700">Historial →</Link></div>
            <div className="mt-4 space-y-3">
              {active?.length ? active.map((a) => <AppointmentRow key={a.id} a={a as ApptListItem} href={`/paciente/citas/${a.id}`} />) : <p className="text-sm text-ink-soft">No tienes citas activas.</p>}
            </div>
          </Card>
        </div>
        <NotificationsCard userId={user.id} back="/paciente" />
      </div>
    </>
  );
}
