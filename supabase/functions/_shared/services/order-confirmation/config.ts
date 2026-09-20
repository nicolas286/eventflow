import { internal } from "../../errors.ts";
import { envTrim, resolveSupabaseRuntimeConfig } from "../../config.ts";

export function resolveRuntimeConfig() {
  const supabase = resolveSupabaseRuntimeConfig();
  const appBaseUrl = envTrim("APP_BASE_URL");

  if (!appBaseUrl) throw internal("APP_BASE_URL_MISSING");

  return { ...supabase, appBaseUrl };
}
