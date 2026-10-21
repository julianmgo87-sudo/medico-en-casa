import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Back, Card } from "@/components/ui";
import { markNotificationsRead } from "@/app/actions/notifications";

/** Notificaciones dentro de la app (siempre visibles, independientemente del envío por correo). */
export async function NotificationsCard({ userId, back }: { userId: string; back: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, title, body, link, created_at, read_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8);
  const unread = data?.filter((n) => !n.read_at).length ?? 0;
  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold">Notificaciones{unread > 0 && <span className="ml-2 rounded-full bg-brand-700 px-2 py-0.5 text-xs text-white">{unread}</span>}</h2>
        {unread > 0 && (
          <form action={markNotificationsRead}><Back to={back} /><button className="text-xs font-semibold text-brand-700">Marcar como leídas</button></form>
        )}
      </div>
      {data?.length ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {data.map((n) => (
            <li key={n.id} className="py-3">
              <p className="flex items-center gap-2 text-sm font-semibold">{!n.read_at && <span className="h-2 w-2 shrink-0 rounded-full bg-brand-600" aria-label="No leída" />}{n.title}</p>
              <p className="text-sm text-ink-soft">{n.body}</p>
              <p className="mt-1 flex gap-3 text-xs text-ink-faint">{formatDateTime(n.created_at)}{n.link && <Link href={n.link} className="font-semibold text-brand-700">Ver</Link>}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-ink-soft">Sin notificaciones.</p>}
    </Card>
  );
}
