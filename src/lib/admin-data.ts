import "server-only";
import { createClient } from "@/lib/supabase/server";

/** Listas de referencia para formularios del administrador. */
export async function getReferenceLists() {
  const supabase = await createClient();
  const [{ data: categories }, { data: specialties }, { data: pros }] = await Promise.all([
    supabase.from("service_categories").select("id, name").order("sort_order"),
    supabase.from("specialties").select("id, name").order("name"),
    supabase.from("professional_profiles").select("user_id, user:users!professional_profiles_user_id_fkey(full_name)").order("created_at"),
  ]);
  return {
    categories: categories ?? [],
    specialties: specialties ?? [],
    professionals: (pros ?? []).map((p) => ({ id: p.user_id as string, name: ((Array.isArray(p.user) ? p.user[0] : p.user) as { full_name: string } | null)?.full_name ?? "" })),
  };
}

export function targetName(row: { scope: string; category_id?: string | null; specialty_id?: string | null; professional_id?: string | null; care_type?: string | null }, lists: Awaited<ReturnType<typeof getReferenceLists>>) {
  if (row.scope === "category") return lists.categories.find((c) => c.id === row.category_id)?.name;
  if (row.scope === "specialty") return lists.specialties.find((c) => c.id === row.specialty_id)?.name;
  if (row.scope === "professional") return lists.professionals.find((c) => c.id === row.professional_id)?.name;
  if (row.scope === "care_type") return row.care_type === "priority" ? "Atención prioritaria" : "Consulta programada";
  return "Todos";
}
