import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, env } from "@/lib/env";

export const getPublicSettings = cache(async (): Promise<Record<string, unknown>> => {
  if (!isSupabaseConfigured()) return {};
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_settings");
  return (data as Record<string, unknown>) ?? {};
});

export type CatalogCategory = {
  id: string; slug: string; name: string; description: string; icon: string;
  booking_enabled: boolean; professionals_count: number; price_from: number | null;
};

export const getCatalog = cache(async (): Promise<CatalogCategory[]> => {
  if (!isSupabaseConfigured()) return [];
  const supabase = await createClient();
  const { data } = await supabase.from("category_catalog").select("*").order("sort_order");
  return (data as CatalogCategory[]) ?? [];
});

export type PublicProfessional = {
  id: string; full_name: string; profession: string; years_experience: number | null; bio: string; photo_path: string | null;
  category_id: string; category_slug: string; category_name: string; booking_enabled: boolean;
  specialty_id: string; specialty_name: string; hourly_rate: number; default_duration_min: number; price_from: number;
  rating_avg: number; rating_count: number; rethus_verified: boolean; zones: string[];
  credentials: { type: string; title: string; institution: string | null; year: number | null }[];
};

export function photoUrl(path: string | null) {
  if (!path) return null;
  return `${env.supabaseUrl}/storage/v1/object/public/professional-photos/${path}`;
}

export function settingNumber(settings: Record<string, unknown>, key: string, fallback: number) {
  const v = Number(settings[key]);
  return Number.isFinite(v) ? v : fallback;
}
