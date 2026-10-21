import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";

export type Role = "patient" | "professional" | "admin";
export type AppUser = { id: string; email: string; role: Role; full_name: string; phone: string | null; status: string };

export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  const { data: row } = await supabase.from("users").select("id, email, role, full_name, phone, status").eq("id", data.user.id).single();
  return (row as AppUser) ?? null;
});

export const ROLE_HOME: Record<Role, string> = { patient: "/paciente", professional: "/profesional", admin: "/admin" };

/** Exige sesión y rol. Redirige si no corresponde. */
export async function requireRole(role: Role) {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/ingresar");
  if (user.status !== "active") redirect("/auth/ingresar?error=" + encodeURIComponent("Tu cuenta está suspendida. Contacta a soporte."));
  if (user.role !== role) redirect(ROLE_HOME[user.role]);
  return user;
}
