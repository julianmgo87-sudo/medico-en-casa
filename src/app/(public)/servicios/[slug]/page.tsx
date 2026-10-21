import { notFound } from "next/navigation";
import Link from "next/link";
import { CategoryIcon } from "@/components/CategoryIcon";
import { ProfessionalCard } from "@/components/ProfessionalCard";
import { EmptyState, Notice, buttonClass } from "@/components/ui";
import { getCatalog, type PublicProfessional } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";
import { formatCOP } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CategoriaPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cat = (await getCatalog()).find((c) => c.slug === slug);
  if (!cat) notFound();
  const supabase = await createClient();
  const { data } = await supabase.from("public_professionals").select("*").eq("category_slug", slug).order("rating_avg", { ascending: false });
  const pros = (data as PublicProfessional[]) ?? [];
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link href="/servicios" className="text-sm font-semibold text-brand-700 hover:underline">← Servicios</Link>
      <div className="mt-4 flex flex-col gap-5 rounded-3xl bg-gradient-to-br from-brand-50 to-teal-50 p-6 sm:flex-row sm:items-center sm:p-8">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white text-brand-700 shadow-card"><CategoryIcon name={cat.icon} className="h-8 w-8" /></span>
        <div className="flex-1">
          <h1 className="font-display text-3xl font-bold">{cat.name}</h1>
          <p className="mt-1 text-ink-soft">{cat.description}</p>
          {cat.price_from ? <p className="mt-2 text-sm font-semibold">Desde {formatCOP(cat.price_from)}</p> : null}
        </div>
        {cat.booking_enabled && pros.length > 0 && <Link href={`/reservar?servicio=${slug}`} className={buttonClass({ size: "lg" })}>Reservar el primero disponible</Link>}
      </div>
      {!cat.booking_enabled && (
        <Notice kind="warning" className="mt-6" title="Servicio aún no habilitado para reservas">
          Estamos verificando los requisitos para prestar este servicio a domicilio. Pronto podrás agendarlo.
        </Notice>
      )}
      <h2 className="mt-10 font-display text-xl font-bold">Profesionales</h2>
      <div className="mt-4">
        {pros.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{pros.map((p) => <ProfessionalCard key={p.id} p={p} />)}</div>
        ) : (
          <EmptyState title="Aún no hay profesionales aprobados en esta categoría." />
        )}
      </div>
    </div>
  );
}
