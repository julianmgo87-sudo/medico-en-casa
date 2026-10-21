import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell, SignUpForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Crear cuenta" };

export default async function RegistroPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Crea tu cuenta de paciente" subtitle="Podrás agendar atención a domicilio con profesionales verificados." searchParams={sp}>
      <SignUpForm role="patient" back="/auth/registro" next={sp.next} />
      <p className="mt-6 text-center text-sm text-ink-soft">¿Ya tienes cuenta? <Link href="/auth/ingresar" className="font-semibold text-brand-700">Ingresa</Link></p>
      <p className="mt-2 text-center text-sm text-ink-soft">¿Eres profesional de la salud? <Link href="/auth/registro-profesional" className="font-semibold text-brand-700">Regístrate aquí</Link></p>
    </AuthShell>
  );
}
