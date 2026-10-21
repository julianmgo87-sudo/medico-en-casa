import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { Card } from "@/components/ui";

/** Notificaciones dentro de la app (siempre visibles, independientemente del envío por correo). */
export async function NotificationsCard({ userId }: { userId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, title, body, link, created_at, read_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(8);
  return (
    <Card>
      <h2 className="font-display text-lg font-bold">Notificaciones</h2>
      {data?.length ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {data.map((n) => (
            <li key={n.id} className="py-3">
              <p className="text-sm font-semibold">{n.title}</p>
              <p className="text-sm text-ink-soft">{n.body}</p>
              <p className="mt-1 flex gap-3 text-xs text-ink-faint">{formatDateTime(n.created_at)}{n.link && <Link href={n.link} className="font-semibold text-brand-700">Ver</Link>}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-ink-soft">Sin notificaciones.</p>}
    </Card>
  );
}
