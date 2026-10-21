// Lectura centralizada de configuración. Las claves privadas solo se leen en el servidor.
export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};

export function isSupabaseConfigured() {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

export function serverEnv() {
  if (typeof window !== "undefined") throw new Error("serverEnv() solo puede usarse en el servidor");
  return {
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    wompiEnv: (process.env.WOMPI_ENV === "production" ? "production" : "sandbox") as "production" | "sandbox",
    wompiPublicKey: process.env.NEXT_PUBLIC_WOMPI_PUBLIC_KEY ?? "",
    wompiPrivateKey: process.env.WOMPI_PRIVATE_KEY ?? "",
    wompiIntegritySecret: process.env.WOMPI_INTEGRITY_SECRET ?? "",
    wompiEventsSecret: process.env.WOMPI_EVENTS_SECRET ?? "",
    resendApiKey: process.env.RESEND_API_KEY ?? "",
    emailFrom: process.env.EMAIL_FROM ?? "",
    cronSecret: process.env.CRON_SECRET ?? "",
  };
}

/** Estado real de cada integración (para el panel de configuración; nunca se simula). */
export function integrationStatus() {
  const s = serverEnv();
  return {
    supabase: isSupabaseConfigured() && Boolean(s.supabaseServiceRoleKey),
    wompi: Boolean(s.wompiPublicKey && s.wompiPrivateKey && s.wompiIntegritySecret && s.wompiEventsSecret),
    wompiEnv: s.wompiEnv,
    email: Boolean(s.resendApiKey && s.emailFrom),
    cron: Boolean(s.cronSecret),
    whatsapp: false,
    push: false,
  };
}
