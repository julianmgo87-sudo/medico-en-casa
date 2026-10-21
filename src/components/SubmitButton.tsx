"use client";
import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { buttonClass } from "@/components/ui";

type Props = ComponentProps<"button"> & { variant?: "primary" | "secondary" | "outline" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; pendingText?: string; confirm?: string };

export function SubmitButton({ variant, size, className, children, pendingText = "Procesando…", confirm, onClick, ...rest }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || rest.disabled}
      aria-busy={pending}
      className={buttonClass({ variant, size, className })}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    >
      {pending ? pendingText : children}
    </button>
  );
}
