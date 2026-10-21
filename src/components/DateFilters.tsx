import { Button, Field, Input, Select } from "@/components/ui";

export function DateFilters({ from, to, extra }: { from: string; to: string; extra?: React.ReactNode }) {
  return (
    <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-card">
      <Field label="Desde"><Input type="date" name="desde" defaultValue={from} /></Field>
      <Field label="Hasta"><Input type="date" name="hasta" defaultValue={to} /></Field>
      {extra}
      <Button type="submit" variant="outline">Aplicar</Button>
    </form>
  );
}

export { Select as FilterSelect };
