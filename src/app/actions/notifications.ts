"use server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { check, runAction } from "@/lib/actions";
import { UserError } from "@/lib/errors";

export async function markNotificationsRead(fd: FormData) {
  await runAction(fd, async () => {
    const user = await getCurrentUser();
    if (!user) throw new UserError("Debes iniciar sesión.");
    check(await (await createClient()).from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).is("read_at", null));
    return "Notificaciones marcadas como leídas.";
  });
}
