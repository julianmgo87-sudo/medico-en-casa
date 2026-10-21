import { Back, Button, Card, Flash, Input, PageHeader, Select, Table, Td } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { grantMembership, setUserRole, setUserStatus } from "@/app/actions/admin";

export default async function AdminPacientes({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase.from("users").select("id, full_name, email, phone, status, role, created_at, suspended_reason").in("role", ["patient", "admin"]).order("created_at", { ascending: false }).limit(200);
  if (sp.q) q = q.or(`full_name.ilike.%${sp.q.replace(/[%,()]/g, "")}%,email.ilike.%${sp.q.replace(/[%,()]/g, "")}%`);
  if (sp.estado) q = q.eq("status", sp.estado);
  const { data: users } = await q;
  const ids = users?.map((u) => u.id) ?? [];
  const { data: mems } = ids.length ? await supabase.from("patient_memberships").select("patient_id, ends_at").eq("status", "active").gt("ends_at", new Date().toISOString()).in("patient_id", ids) : { data: [] };
  const back = "/admin/pacientes" + (sp.q ? `?q=${encodeURIComponent(sp.q)}` : "");
  return (
    <>
      <PageHeader title="Gestión de pacientes" />
      <Flash searchParams={sp} />
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Nombre o correo" className="max-w-xs" />
        <Select name="estado" defaultValue={sp.estado ?? ""} className="max-w-[180px]"><option value="">Todos</option><option value="active">Activos</option><option value="suspended">Suspendidos</option></Select>
        <Button variant="outline">Buscar</Button>
      </form>
      <Card>
        <Table head={["Usuario", "Celular", "Registro", "Membresía", "Acciones"]} empty={!users?.length}>
          {users?.map((u) => {
            const m = mems?.filter((x) => x.patient_id === u.id).sort((a, b) => b.ends_at.localeCompare(a.ends_at))[0];
            return (
              <tr key={u.id}>
                <Td><p className="font-semibold">{u.full_name}{u.role === "admin" && <span className="ml-2 text-xs text-brand-700">ADMIN</span>}</p><p className="text-xs text-ink-soft">{u.email}</p>{u.status === "suspended" && <p className="text-xs text-red-700">Suspendido: {u.suspended_reason}</p>}</Td>
                <Td>{u.phone ?? "—"}</Td>
                <Td>{formatDate(u.created_at, { dateStyle: "medium" })}</Td>
                <Td>{m ? `Activa hasta ${formatDate(m.ends_at, { dateStyle: "medium" })}` : "—"}</Td>
                <Td>
                  <details>
                    <summary className="cursor-pointer text-sm font-semibold text-brand-700">Gestionar</summary>
                    <div className="mt-2 w-72 space-y-3">
                      {u.role === "patient" && (
                        <form action={grantMembership} className="space-y-1"><Back to={back} /><input type="hidden" name="patient_id" value={u.id} />
                          <p className="text-xs font-semibold">Exención / cortesía</p>
                          <div className="flex gap-1"><Input name="days" type="number" min={1} defaultValue={30} className="w-20" /><Input name="notes" placeholder="Motivo" required /></div>
                          <SubmitButton size="sm" variant="outline">Otorgar</SubmitButton></form>
                      )}
                      <form action={setUserStatus} className="space-y-1"><Back to={back} /><input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="status" value={u.status === "active" ? "suspended" : "active"} />
                        {u.status === "active" && <Input name="reason" placeholder="Motivo de suspensión" required />}
                        <SubmitButton size="sm" variant={u.status === "active" ? "danger" : "outline"}>{u.status === "active" ? "Suspender" : "Reactivar"}</SubmitButton></form>
                      <form action={setUserRole} className="space-y-1"><Back to={back} /><input type="hidden" name="user_id" value={u.id} /><input type="hidden" name="role" value={u.role === "admin" ? "patient" : "admin"} />
                        <Input name="confirm" placeholder="Escribe CONFIRMAR" />
                        <SubmitButton size="sm" variant="ghost">{u.role === "admin" ? "Quitar rol administrador" : "Convertir en administrador"}</SubmitButton></form>
                    </div>
                  </details>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
