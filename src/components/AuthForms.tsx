import Link from "next/link";
import { Back, Field, Flash, Input } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { signUp } from "@/app/actions/auth";

export function AuthShell({ title, subtitle, children, searchParams }: { title: string; subtitle?: string; children: React.ReactNode; searchParams: Record<string, string | undefined> }) {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div className="rounded-3xl border border-slate-100 bg-white p-6 shadow-lift sm:p-8">
        <h1 className="font-display text-2xl font-bold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>}
        <div className="mt-6"><Flash searchParams={searchParams} /></div>
        {children}
      </div>
    </div>
  );
}

export function SignUpForm({ role, back, next }: { role: "patient" | "professional"; back: string; next?: string }) {
  return (
    <form action={signUp} className="space-y-4">
      <Back to={back} />
      <input type="hidden" name="role" value={role} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Nombre completo"><Input name="full_name" required autoComplete="name" /></Field>
      <Field label="Correo electrónico"><Input name="email" type="email" required autoComplete="email" /></Field>
      <Field label="Celular" hint="10 dígitos, por ejemplo 3001234567"><Input name="phone" type="tel" inputMode="tel" required autoComplete="tel" pattern="(\+?57)?3[0-9]{9}" /></Field>
      <Field label="Contraseña" hint="Mínimo 8 caracteres, con letras y números"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
      <Field label="Confirmar contraseña"><Input name="password_confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
      <label className="flex gap-3 text-sm"><input type="checkbox" name="terms" required className="mt-1 h-4 w-4 rounded border-slate-300" /><span>Acepto los <Link href="/terminos" target="_blank" className="font-semibold text-brand-700 underline">términos y condiciones</Link>.</span></label>
      <label className="flex gap-3 text-sm"><input type="checkbox" name="data_consent" required className="mt-1 h-4 w-4 rounded border-slate-300" />
        <span>Autorizo de manera previa, expresa e informada el tratamiento de mis datos personales, incluidos datos sensibles relacionados con mi salud cuando los suministre, conforme a la <Link href="/privacidad" target="_blank" className="font-semibold text-brand-700 underline">política de tratamiento de datos</Link> (Ley 1581 de 2012).</span></label>
      <SubmitButton size="lg" className="w-full" pendingText="Creando cuenta…">Crear cuenta</SubmitButton>
    </form>
  );
}
