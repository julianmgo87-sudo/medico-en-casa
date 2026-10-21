import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import { Back, Card, Flash, Notice, PageHeader, buttonClass } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { formatCOP, formatDate } from "@/lib/format";
import { isWompiConfigured } from "@/lib/wompi";
import { startMembershipCheckout } from "@/app/actions/payments";

export const metadata: Metadata = { title: "Membresías" };
export const dynamic = "force-dynamic";

export default async function MembresiasPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const user = await getCurrentUser();
  const { data: plans } = await supabase.from("membership_plans").select("*").eq("is_active", true).order("sort_order");
  const { data: current } = user?.role === "patient"
    ? await supabase.from("patient_memberships").select("id, status, starts_at, ends_at, plan:membership_plans(name)").eq("patient_id", user.id).in("status", ["active"]).order("ends_at", { ascending: false }).limit(1)
    : { data: null };
  const active = current?.[0];
  const gateway = isWompiConfigured();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <PageHeader title="Membresías" subtitle="La membresía te da acceso al sistema de reservas durante su vigencia. Cada consulta se paga por separado." />
      <Flash searchParams={sp} />
      {active && (
        <Notice kind="success" className="mb-6" title="Tienes una membresía activa">
          Vigente hasta el {formatDate(active.ends_at)}. Si compras otra ahora, se sumará al terminar la actual.
        </Notice>
      )}
      {!gateway && (
        <Notice kind="warning" className="mb-6" title="Pagos aún no habilitados">
          La pasarela de pagos (Wompi) no está configurada en este entorno, por lo que todavía no es posible comprar membresías pagas.
        </Notice>
      )}
      <div className="grid gap-5 md:grid-cols-2">
        {plans?.map((p) => (
          <Card key={p.id} className="flex flex-col">
            <h2 className="font-display text-xl font-bold">{p.name}</h2>
            <p className="mt-1 text-sm text-ink-soft">{p.description}</p>
            <p className="mt-5 font-display text-4xl font-extrabold">{formatCOP(p.price)}</p>
            <p className="text-sm text-ink-soft">Vigencia de {p.duration_days} días</p>
            <ul className="mt-5 space-y-2 text-sm">
              {["Acceso a reservas con todos los profesionales", "Atención programada y prioritaria", "Seguimiento del estado de tus citas", "Historial y comprobantes"].map((b) => (
                <li key={b} className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-teal-600" /> {b}</li>
              ))}
              <li className="flex gap-2 text-ink-soft"><span className="w-4 shrink-0 text-center">—</span> No incluye el valor de las consultas</li>
            </ul>
            <div className="mt-auto pt-6">
              {!user ? (
                <Link href="/auth/registro?next=/membresias" className={buttonClass({ className: "w-full", size: "lg" })}>Crear cuenta para comprar</Link>
              ) : user.role !== "patient" ? (
                <p className="text-sm text-ink-soft">Las membresías son para cuentas de paciente.</p>
              ) : (
                <form action={startMembershipCheckout}>
                  <Back to="/membresias" />
                  <input type="hidden" name="plan_id" value={p.id} />
                  <SubmitButton size="lg" className="w-full" disabled={Number(p.price) > 0 && !gateway} pendingText="Redirigiendo a la pasarela…">
                    {Number(p.price) === 0 ? "Activar" : active ? "Renovar / extender" : "Comprar membresía"}
                  </SubmitButton>
                </form>
              )}
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-ink-soft">Pagos procesados por Wompi (Bancolombia): tarjeta débito/crédito, PSE, Nequi y otros medios habilitados para el comercio. Médico en Casa Palmira no almacena datos de tarjetas.</p>
      {user?.role === "patient" && <p className="mt-2 text-sm"><Link className="font-semibold text-brand-700 hover:underline" href="/paciente/pagos">Ver mi historial de pagos →</Link></p>}
    </div>
  );
}
