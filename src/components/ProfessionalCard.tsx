import Link from "next/link";
import { BadgeCheck, MapPin, Star } from "lucide-react";
import { type PublicProfessional, photoUrl } from "@/lib/data";
import { formatCOP } from "@/lib/format";
import { buttonClass } from "@/components/ui";

export function Avatar({ name, path, className = "h-16 w-16" }: { name: string; path: string | null; className?: string }) {
  const url = photoUrl(path);
  const initials = name.split(" ").filter(Boolean).slice(0, 2).map((p) => p[0]).join("").toUpperCase();
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={`Foto de ${name}`} className={`${className} shrink-0 rounded-2xl object-cover`} />
  ) : (
    <div className={`${className} flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-teal-100 font-display text-lg font-bold text-brand-800`} aria-hidden>
      {initials}
    </div>
  );
}

export function ProfessionalCard({ p }: { p: PublicProfessional }) {
  return (
    <article className="flex flex-col rounded-2xl border border-slate-100 bg-white p-5 shadow-card transition hover:shadow-lift">
      <div className="flex gap-4">
        <Avatar name={p.full_name} path={p.photo_path} />
        <div className="min-w-0">
          <h3 className="truncate font-display text-lg font-bold text-ink">{p.full_name}</h3>
          <p className="text-sm text-ink-soft">{p.profession} · {p.specialty_name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-soft">
            {p.rethus_verified && <span className="inline-flex items-center gap-1 font-semibold text-teal-700"><BadgeCheck className="h-4 w-4" /> RETHUS verificado</span>}
            {p.rating_count > 0 && <span className="inline-flex items-center gap-1"><Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" /> {Number(p.rating_avg).toFixed(1)} ({p.rating_count})</span>}
            {p.years_experience ? <span>{p.years_experience} años de experiencia</span> : null}
          </div>
        </div>
      </div>
      {p.zones.length > 0 && (
        <p className="mt-4 flex items-start gap-1.5 text-xs text-ink-soft"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {p.zones.slice(0, 4).join(", ")}{p.zones.length > 4 ? "…" : ""}</p>
      )}
      <div className="mt-auto flex items-end justify-between gap-3 pt-5">
        <div>
          <p className="text-xs text-ink-soft">Consulta de {p.default_duration_min} min desde</p>
          <p className="font-display text-xl font-bold text-ink">{formatCOP(p.price_from)}</p>
        </div>
        <Link href={`/profesionales/${p.id}`} className={buttonClass({ size: "sm" })}>Ver perfil</Link>
      </div>
    </article>
  );
}
