"use server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { runAction, str, required } from "@/lib/actions";
import { UserError } from "@/lib/errors";
import { env } from "@/lib/env";
import { ROLE_HOME, type Role } from "@/lib/auth";

function authError(message: string) {
  if (/invalid login credentials/i.test(message)) return "Correo o contraseña incorrectos.";
  if (/email not confirmed/i.test(message)) return "Debes confirmar tu correo antes de ingresar. Revisa tu bandeja de entrada.";
  if (/already registered|already exists/i.test(message)) return "Ya existe una cuenta con este correo.";
  if (/password should be|weak password|at least/i.test(message)) return "La contraseña debe tener al menos 8 caracteres e incluir letras y números.";
  if (/rate limit|too many/i.test(message)) return "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.";
  if (/same.*password|different from the old/i.test(message)) return "La nueva contraseña debe ser diferente de la anterior.";
  return "No fue posible completar la solicitud. Inténtalo de nuevo.";
}

function safeNext(next: string, fallback: string) {
  return next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : env.appUrl;
}

function validatePassword(pw: string, confirm: string) {
  if (pw.length < 8 || !/[a-zA-Z]/.test(pw) || !/\d/.test(pw)) throw new UserError("La contraseña debe tener al menos 8 caracteres e incluir letras y números.");
  if (pw !== confirm) throw new UserError("Las contraseñas no coinciden.");
}

export async function signUp(formData: FormData) {
  await runAction(formData, async () => {
    const role = (str(formData, "role") === "professional" ? "professional" : "patient") as Role;
    const fullName = required(formData, "full_name", "Nombre completo");
    const email = required(formData, "email", "Correo electrónico").toLowerCase();
    const phone = required(formData, "phone", "Celular").replace(/[^\d+]/g, "");
    if (!/^(\+?57)?3\d{9}$/.test(phone)) throw new UserError("Ingresa un número celular colombiano válido (10 dígitos, empieza por 3).");
    const password = str(formData, "password");
    validatePassword(password, str(formData, "password_confirm"));
    if (formData.get("terms") !== "on") throw new UserError("Debes aceptar los términos y condiciones.");
    if (formData.get("data_consent") !== "on") throw new UserError("Debes autorizar el tratamiento de tus datos personales para crear la cuenta.");

    const supabase = await createClient();
    const next = role === "professional" ? "/profesional/perfil" : safeNext(str(formData, "next"), "/paciente");
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(next)}`,
        data: { full_name: fullName, phone: phone.replace(/^\+?57/, ""), role, terms_accepted: "true", data_consent: "true" },
      },
    });
    if (error) throw new UserError(authError(error.message));
    return `redirect:/auth/ingresar?ok=${encodeURIComponent("Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego inicia sesión.")}`;
  }, "/auth/registro");
}

export async function signIn(formData: FormData) {
  await runAction(formData, async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email: str(formData, "email").toLowerCase(), password: str(formData, "password") });
    if (error) throw new UserError(authError(error.message));
    const { data: profile } = await supabase.from("users").select("role, status").eq("id", data.user.id).single();
    if (profile?.status === "suspended") {
      await supabase.auth.signOut();
      throw new UserError("Tu cuenta está suspendida. Contacta a soporte.");
    }
    const home = ROLE_HOME[(profile?.role ?? "patient") as Role];
    return "redirect:" + safeNext(str(formData, "next"), home);
  }, "/auth/ingresar");
}

export async function requestPasswordReset(formData: FormData) {
  await runAction(formData, async () => {
    const supabase = await createClient();
    const email = required(formData, "email", "Correo electrónico").toLowerCase();
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/callback?next=/auth/nueva-contrasena` });
    // Mismo mensaje exista o no la cuenta (evita enumeración de usuarios).
    return "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.";
  }, "/auth/recuperar");
}

export async function updatePassword(formData: FormData) {
  await runAction(formData, async () => {
    const password = str(formData, "password");
    validatePassword(password, str(formData, "password_confirm"));
    const supabase = await createClient();
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw new UserError("El enlace venció. Solicita uno nuevo.");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new UserError(authError(error.message));
    return `redirect:/auth/ingresar?ok=${encodeURIComponent("Contraseña actualizada. Ya puedes ingresar.")}`;
  }, "/auth/nueva-contrasena");
}
