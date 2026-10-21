import { PageHeader, EmptyState, Select, Button } from "@/components/ui";
import { AppointmentRow, type ApptListItem } from "@/components/AppointmentRow";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { APPOINTMENT_STATUS } from "@/lib/status";

export default async function CitasPage({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  const sp = await searchParams;
  const user = await requireRole("patient");
  const supabase = await createClient();
  let q = supabase.from("appointments").select("id, code, status, care_type, starts_at, total_amount, specialty:specialties(name)").eq("patient_id", user.id).order("starts_at", { ascending: false }).limit(100);
  if (sp.estado && sp.estado in APPOINTMENT_STATUS) q = q.eq("status", sp.estado);
  const { data } = await q;
  return (
    <>
      <PageHeader title="Historial de citas" />
      <form className="mb-4 flex gap-2" method="get">
        <Select name="estado" defaultValue={sp.estado ?? ""} className="max-w-xs">
          <option value="">Todos los estados</option>
          {Object.entries(APPOINTMENT_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Button type="submit" variant="outline">Filtrar</Button>
      </form>
      <div className="space-y-3">
        {data?.length ? data.map((a) => <AppointmentRow key={a.id} a={a as ApptListItem} href={`/paciente/citas/${a.id}`} />) : <EmptyState title="Aún no tienes citas." />}
      </div>
    </>
  );
}
