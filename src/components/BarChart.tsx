// Gráfico de barras de una sola serie, renderizado en el servidor (sin librerías).
// Un solo tono (sin leyenda: el título nombra la serie), valor al pasar el cursor,
// y tabla alternativa accesible.
type Datum = { label: string; value: number };

export function BarChart({ title, data, format = (v) => String(v), horizontal = false }: { title: string; data: Datum[]; format?: (v: number) => string; horizontal?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="rounded-2xl border border-slate-100 bg-white p-5 shadow-card">
      <figcaption className="mb-4 text-sm font-semibold text-ink">{title}</figcaption>
      {data.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-soft">Sin datos en el periodo.</p>
      ) : horizontal ? (
        <ul className="space-y-2.5" aria-hidden>
          {data.map((d) => (
            <li key={d.label} className="group grid grid-cols-[minmax(0,140px)_1fr_auto] items-center gap-3 text-xs">
              <span className="truncate text-ink-soft" title={d.label}>{d.label}</span>
              <span className="h-3 rounded-r bg-slate-100">
                <span className="block h-3 rounded-r-[4px] bg-brand-600 transition group-hover:bg-brand-800" style={{ width: `${(d.value / max) * 100}%` }} />
              </span>
              <span className="tabular-nums text-ink">{format(d.value)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex h-44 items-end gap-[2px] border-b border-slate-200" aria-hidden>
          {data.map((d) => (
            <div key={d.label} className="group relative flex h-full flex-1 items-end" title={`${d.label}: ${format(d.value)}`}>
              <div className="mx-auto w-full max-w-[40px] rounded-t-[4px] bg-brand-600 transition group-hover:bg-brand-800" style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }} />
              <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-white group-hover:block">{d.label}: {format(d.value)}</span>
            </div>
          ))}
        </div>
      )}
      {!horizontal && data.length > 0 && (
        <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint"><span>{data[0].label}</span><span>{data[data.length - 1].label}</span></div>
      )}
      {data.length > 0 && (
        <details className="mt-3 text-xs text-ink-soft">
          <summary className="cursor-pointer">Ver como tabla</summary>
          <table className="mt-2 w-full"><tbody>{data.map((d) => <tr key={d.label}><td className="py-0.5">{d.label}</td><td className="text-right tabular-nums">{format(d.value)}</td></tr>)}</tbody></table>
        </details>
      )}
    </figure>
  );
}
