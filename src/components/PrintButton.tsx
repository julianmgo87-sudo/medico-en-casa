"use client";
import { buttonClass } from "@/components/ui";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={buttonClass({ variant: "outline", size: "sm", className: "print:hidden" })}>Descargar / imprimir</button>;
}
