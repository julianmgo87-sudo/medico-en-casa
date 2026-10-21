import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isAuthorizedCron } from "@/lib/cron-auth";
import { dispatchPendingEmails } from "@/lib/notifications";

export const dynamic = "force-dynamic";

/** Respaldo HTTP de pg_cron: vencimientos, devoluciones automáticas, membresías, recordatorios + envío de correos. */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("run_scheduled_jobs");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const emails = await dispatchPendingEmails(100);
  return NextResponse.json({ jobs: data, emails });
}
