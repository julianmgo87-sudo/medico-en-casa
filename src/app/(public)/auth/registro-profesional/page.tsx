import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, SignUpForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Registro de profesionales" };

export default async function RegistroProfesionalPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Registro de profesionales de la salud" subtitle="Crea tu cuenta y completa tu perfil. No recibirás solicitudes hasta que el equipo apruebe tu documentación." searchParams={sp}>
      <ul className="mb-6 space-y-1 rounded-2xl bg-brand-50 p-4 text-sm text-brand-900">
        <li>1. Crea la cuenta y confirma tu correo.</li>
        <li>2. Completa tu perfil, zonas, tarifa propuesta y agenda.</li>
        <li>3. Sube títulos, tarjeta profesional y soporte RETHUS.</li>
        <li>4. Envía a revisión: el administrador verifica y define la tarifa final.</li>
      </ul>
      <SignUpForm role="professional" back="/auth/registro-profesional" />
      <p className="mt-6 text-center text-sm text-ink-soft">¿Ya tienes cuenta? <Link href="/auth/ingresar" className="font-semibold text-brand-700">Ingresa</Link></p>
    </AuthShell>
  );
}
