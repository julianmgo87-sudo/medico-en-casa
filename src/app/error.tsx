"use client";
import { buttonClass } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="font-display text-2xl font-bold">Algo salió mal</h1>
      <p className="mt-2 text-ink-soft">Ocurrió un error inesperado. Intenta de nuevo; si persiste, contacta a soporte.</p>
      <button onClick={reset} className={buttonClass({ className: "mt-6" })}>Reintentar</button>
    </main>
  );
}
