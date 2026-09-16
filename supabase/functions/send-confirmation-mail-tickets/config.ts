import { internal } from "../_shared/errors.ts";
import { envTrim, resolveSupabaseRuntimeConfig } from "../_shared/config.ts";

export function resolveRuntimeConfig() {
  const supabase = resolveSupabaseRuntimeConfig();
  const appBaseUrl = envTrim("APP_BASE_URL");
  const edgeServiceToken = envTrim("EDGE_SERVICE_TOKEN");

  if (!appBaseUrl) throw internal("APP_BASE_URL_MISSING");
  if (!edgeServiceToken) throw internal("EDGE_SERVICE_TOKEN_MISSING");

  return { ...supabase, appBaseUrl, edgeServiceToken };
}
