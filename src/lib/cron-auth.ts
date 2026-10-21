import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { serverEnv } from "@/lib/env";

/** Autoriza llamadas de procesos programados (Vercel Cron envía Authorization: Bearer CRON_SECRET). */
export function isAuthorizedCron(req: NextRequest) {
  const secret = serverEnv().cronSecret;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
