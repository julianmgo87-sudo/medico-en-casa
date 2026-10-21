import Link from "next/link";
import { buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <p className="font-display text-6xl font-extrabold text-brand-700">404</p>
      <h1 className="mt-2 font-display text-2xl font-bold">Página no encontrada</h1>
      <p className="mt-2 text-ink-soft">La página que buscas no existe o fue movida.</p>
      <Link href="/" className={buttonClass({ className: "mt-6" })}>Ir al inicio</Link>
    </main>
  );
}
