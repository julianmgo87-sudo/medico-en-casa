import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthForms";
import { Back, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { requestPasswordReset } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Recuperar contraseña" };

export default async function RecuperarPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Recuperar contraseña" subtitle="Te enviaremos un enlace a tu correo para crear una nueva contraseña." searchParams={sp}>
      <form action={requestPasswordReset} className="space-y-4">
        <Back to="/auth/recuperar" />
        <Field label="Correo electrónico"><Input name="email" type="email" required autoComplete="email" /></Field>
        <SubmitButton size="lg" className="w-full">Enviar enlace</SubmitButton>
      </form>
    </AuthShell>
  );
}
