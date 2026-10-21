import Link from "next/link";
import { Menu, PhoneCall } from "lucide-react";
import { Logo } from "@/components/Logo";
import { buttonClass } from "@/components/ui";
import { getCurrentUser, ROLE_HOME } from "@/lib/auth";

const NAV = [
  { href: "/servicios", label: "Servicios" },
  { href: "/profesionales", label: "Profesionales" },
  { href: "/membresias", label: "Membresías" },
  { href: "/#como-funciona", label: "Cómo funciona" },
];

export function EmergencyBar() {
  return (
    <div className="bg-ink text-white">
      <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-1.5 text-center text-xs sm:text-[13px]">
        <PhoneCall className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          ¿Emergencia vital? Llama de inmediato a la <strong>línea 123</strong> o acude a urgencias. Esta plataforma no atiende emergencias.
        </span>
      </p>
    </div>
  );
}

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <>
      <EmergencyBar />
      <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Principal">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="rounded-full px-3.5 py-2 text-sm font-medium text-ink-soft hover:bg-brand-50 hover:text-brand-800">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {user ? (
              <>
                <Link href={ROLE_HOME[user.role]} className={buttonClass({ variant: "outline", size: "sm" })}>Mi panel</Link>
                <form action="/auth/salir" method="post">
                  <button className={buttonClass({ variant: "ghost", size: "sm" })}>Salir</button>
                </form>
              </>
            ) : (
              <>
                <Link href="/auth/ingresar" className={buttonClass({ variant: "ghost", size: "sm" })}>Ingresar</Link>
                <Link href="/auth/registro" className={buttonClass({ size: "sm" })}>Crear cuenta</Link>
              </>
            )}
          </div>
          <details className="relative md:hidden">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-slate-200" aria-label="Abrir menú">
              <Menu className="h-5 w-5" />
            </summary>
            <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-slate-100 bg-white p-2 shadow-lift">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="block rounded-xl px-4 py-3 text-[15px] font-medium hover:bg-brand-50">{n.label}</Link>
              ))}
              <div className="my-2 border-t border-slate-100" />
              {user ? (
                <>
                  <Link href={ROLE_HOME[user.role]} className="block rounded-xl px-4 py-3 font-semibold text-brand-800 hover:bg-brand-50">Mi panel</Link>
                  <form action="/auth/salir" method="post"><button className="w-full rounded-xl px-4 py-3 text-left hover:bg-brand-50">Salir</button></form>
                </>
              ) : (
                <>
                  <Link href="/auth/ingresar" className="block rounded-xl px-4 py-3 hover:bg-brand-50">Ingresar</Link>
                  <Link href="/auth/registro" className="block rounded-xl px-4 py-3 font-semibold text-brand-800 hover:bg-brand-50">Crear cuenta</Link>
                </>
              )}
            </div>
          </details>
        </div>
      </header>
    </>
  );
}
