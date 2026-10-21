import Link from "next/link";
import type { Metadata } from "next";
import { CategoryIcon } from "@/components/CategoryIcon";
import { PageHeader, buttonClass } from "@/components/ui";
import { getCatalog } from "@/lib/data";
import { formatCOP } from "@/lib/format";

export const metadata: Metadata = { title: "Servicios" };
export const dynamic = "force-dynamic";

export default async function ServiciosPage() {
  const catalog = await getCatalog();
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <PageHeader title="Catálogo de servicios" subtitle="Servicios de salud a domicilio en Palmira. Puedes consultarlos sin membresía." />
      <div className="grid gap-5 md:grid-cols-2">
        {catalog.map((c) => (
          <article key={c.id} className="flex gap-5 rounded-2xl border border-slate-100 bg-white p-6 shadow-card">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-700"><CategoryIcon name={c.icon} className="h-7 w-7" /></span>
            <div className="flex flex-1 flex-col">
              <h2 className="font-display text-xl font-bold">{c.name}</h2>
              <p className="mt-1 text-sm text-ink-soft">{c.description}</p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-ink-soft">Profesionales</dt><dd className="font-semibold">{c.professionals_count}</dd></div>
                <div><dt className="text-ink-soft">Precio desde</dt><dd className="font-semibold">{c.price_from ? formatCOP(c.price_from) : "—"}</dd></div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={`/servicios/${c.slug}`} className={buttonClass({ variant: "outline", size: "sm" })}>Ver profesionales y horarios</Link>
                {c.booking_enabled && c.professionals_count > 0 ? (
                  <Link href={`/reservar?servicio=${c.slug}`} className={buttonClass({ size: "sm" })}>Reservar</Link>
                ) : (
                  <span className="inline-flex h-9 items-center rounded-full bg-amber-50 px-4 text-sm font-semibold text-amber-800">
                    {c.booking_enabled ? "Sin profesionales disponibles aún" : "Próximamente: en verificación"}
                  </span>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
