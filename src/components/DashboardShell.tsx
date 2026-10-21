import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";

export type NavItem = { href: string; label: string };

export function DashboardShell({ title, nav, children }: { title: string; nav: NavItem[]; children: React.ReactNode }) {
  return (
    <>
      <div className="print:hidden"><SiteHeader /></div>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 lg:grid-cols-[230px_1fr] lg:py-10">
        <aside className="print:hidden lg:sticky lg:top-24 lg:self-start">
          <p className="mb-2 hidden px-3 text-xs font-bold uppercase tracking-wider text-ink-faint lg:block">{title}</p>
          <nav aria-label={title} className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:px-0">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="shrink-0 rounded-xl px-3 py-2 text-sm font-medium text-ink-soft hover:bg-brand-50 hover:text-brand-800">
                {n.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="min-w-0">{children}</main>
      </div>
    </>
  );
}
