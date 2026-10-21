import type { Metadata } from "next";
import { AuthShell } from "@/components/AuthForms";
import { Back, Field, Input } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { updatePassword } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Nueva contraseña" };

export default async function NuevaContrasenaPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <AuthShell title="Crea una nueva contraseña" searchParams={sp}>
      <form action={updatePassword} className="space-y-4">
        <Back to="/auth/nueva-contrasena" />
        <Field label="Nueva contraseña" hint="Mínimo 8 caracteres, con letras y números"><Input name="password" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <Field label="Confirmar contraseña"><Input name="password_confirm" type="password" required minLength={8} autoComplete="new-password" /></Field>
        <SubmitButton size="lg" className="w-full">Guardar contraseña</SubmitButton>
      </form>
    </AuthShell>
  );
}
