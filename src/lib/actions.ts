import "server-only";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { friendlyError, UserError } from "@/lib/errors";

type Supa = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** Llama una función RPC y lanza un error legible si falla. */
export async function rpc<T = unknown>(supabase: Supa, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new UserError(friendlyError(error as never));
  return data as T;
}

/** Lanza un error legible si una operación de tabla falló. */
export function check<T extends { error: unknown }>(res: T): T {
  if (res.error) throw new UserError(friendlyError(res.error as never));
  return res;
}

function withParam(path: string, key: string, value: string) {
  const [base, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.delete("ok");
  params.delete("error");
  params.set(key, value);
  return `${base}?${params.toString()}`;
}

/**
 * Ejecuta una acción de formulario y regresa a la página de origen con un mensaje
 * (?ok= o ?error=). Funciona sin JavaScript en el navegador.
 */
export async function runAction(formData: FormData, fn: () => Promise<string | void>, fallbackPath = "/") {
  const back = String(formData.get("_back") || fallbackPath);
  const safeBack = back.startsWith("/") && !back.startsWith("//") ? back : fallbackPath;
  let target: string;
  try {
    const result = await fn();
    if (result && result.startsWith("redirect:")) {
      const to = result.slice("redirect:".length);
      target = to.startsWith("/") && !to.startsWith("//") ? to : safeBack;
    } else if (result && result.startsWith("external:")) {
      // Solo se permite redirigir al checkout de la pasarela.
      const to = result.slice("external:".length);
      target = to.startsWith("https://checkout.wompi.co/") ? to : safeBack;
    } else {
      target = withParam(safeBack, "ok", result || "Cambios guardados.");
    }
  } catch (e) {
    const message = e instanceof UserError ? e.message : (console.error("[action]", e), "Ocurrió un error inesperado.");
    target = withParam(safeBack, "error", message);
  }
  revalidatePath(safeBack.split("?")[0]);
  redirect(target);
}

export function str(fd: FormData, key: string) {
  const v = fd.get(key);
  return typeof v === "string" ? v.trim() : "";
}
export function num(fd: FormData, key: string) {
  const v = str(fd, key);
  if (v === "") return null;
  // Acepta "100.000" (separador de miles) y "12,5" o "12.5" (decimales)
  const normalized = /^-?\d{1,3}(\.\d{3})+$/.test(v) ? v.replace(/\./g, "") : v.replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) throw new UserError(`Valor numérico inválido en "${key}".`);
  return n;
}
export function required(fd: FormData, key: string, label: string) {
  const v = str(fd, key);
  if (!v) throw new UserError(`El campo "${label}" es obligatorio.`);
  return v;
}
