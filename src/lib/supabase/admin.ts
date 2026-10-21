import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env, serverEnv } from "@/lib/env";

/**
 * Cliente con service_role: omite RLS. Usar ÚNICAMENTE en rutas de servidor de
 * confianza (webhooks verificados, procesos programados, envío de correos).
 */
export function createAdminClient() {
  const key = serverEnv().supabaseServiceRoleKey;
  if (!env.supabaseUrl || !key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_URL");
  return createClient(env.supabaseUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
