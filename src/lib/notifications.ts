import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv, env } from "@/lib/env";

/**
 * Envía por correo las notificaciones pendientes (bandeja de salida en la tabla
 * notifications). Si el proveedor no está configurado, NO marca nada como enviado.
 * WhatsApp y push: el canal existe en el modelo de datos pero no hay integración activa.
 */
export async function dispatchPendingEmails(limit = 50) {
  const s = serverEnv();
  if (!s.resendApiKey || !s.emailFrom) return { configured: false, sent: 0, failed: 0 };
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("notifications")
    .select("id, title, body, link, attempts, user:users(email, full_name)")
    .eq("status", "pending")
    .eq("channel", "email")
    .lt("attempts", 5)
    .order("created_at")
    .limit(limit);
  if (error) throw new Error(error.message);

  let sent = 0;
  let failed = 0;
  for (const n of rows ?? []) {
    const user = (Array.isArray(n.user) ? n.user[0] : n.user) as { email: string; full_name: string } | null;
    if (!user?.email) {
      await admin.from("notifications").update({ status: "skipped", last_error: "Usuario sin correo" }).eq("id", n.id);
      continue;
    }
    const link = n.link ? new URL(n.link, env.appUrl).toString() : env.appUrl;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${s.resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: s.emailFrom, to: [user.email], subject: n.title, html: emailHtml(user.full_name, n.title, n.body, link), text: `${n.body}\n\n${link}` }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      await admin.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), attempts: n.attempts + 1 }).eq("id", n.id);
      sent++;
    } catch (e) {
      const attempts = n.attempts + 1;
      await admin.from("notifications").update({ attempts, last_error: String(e).slice(0, 500), status: attempts >= 5 ? "failed" : "pending" }).eq("id", n.id);
      failed++;
    }
  }
  return { configured: true, sent, failed };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function emailHtml(name: string, title: string, body: string, link: string) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4f8fd;font-family:Arial,sans-serif;color:#0f1f3a">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:32px">
<tr><td style="font-size:13px;font-weight:bold;color:#1648d0;letter-spacing:.08em">MÉDICO EN CASA PALMIRA</td></tr>
<tr><td style="padding-top:16px;font-size:22px;font-weight:bold">${escapeHtml(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:15px;line-height:1.6">Hola ${escapeHtml(name || "")},<br>${escapeHtml(body)}</td></tr>
<tr><td style="padding-top:24px"><a href="${escapeHtml(link)}" style="background:#1648d0;color:#fff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:bold">Ver detalle</a></td></tr>
<tr><td style="padding-top:28px;font-size:12px;color:#64748b">Si tienes una emergencia médica, llama al 123. Este correo es automático.</td></tr>
</table></td></tr></table></body></html>`;
}
