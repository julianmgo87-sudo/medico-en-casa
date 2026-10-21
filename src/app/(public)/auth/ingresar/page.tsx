import Link from "next/link";
import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthForms";
import { Back, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { signIn } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Iniciar sesión" };

export default async function IngresarPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const back = sp.next ? `/auth/ingresar?next=${encodeURIComponent(sp.next)}` : "/auth/ingresar";
  return (
    <AuthShell title="Iniciar sesión" searchParams={sp}>
      <form action={signIn} className="space-y-4">
        <Back to={back} />
        {sp.next && <input type="hidden" name="next" value={sp.next} />}
        <Field label="Correo electrónico"><Input name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Contraseña"><Input name="password" type="password" required autoComplete="current-password" /></Field>
        <SubmitButton size="lg" className="w-full" pendingText="Ingresando…">Ingresar</SubmitButton>
      </form>
      <div className="mt-6 space-y-2 text-center text-sm text-ink-soft">
        <p><Link href="/auth/recuperar" className="font-semibold text-brand-700">¿Olvidaste tu contraseña?</Link></p>
        <p>¿No tienes cuenta? <Link href="/auth/registro" className="font-semibold text-brand-700">Regístrate</Link></p>
      </div>
    </AuthShell>
  );
}
