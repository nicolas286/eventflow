import { assertFunctionsUrl } from "../../_shared/environment-safety.ts";
import { internal } from "../../_shared/errors.ts";
import { envTrim, resolveSupabaseRuntimeConfig } from "../../_shared/config.ts";
import {
  parseAllowedOrigins,
  resolveAppBaseUrlFromRequest,
} from "../../_shared/url.ts";

export function resolveRuntimeConfig(req: Request) {
  const supabase = resolveSupabaseRuntimeConfig();
  const registerRateLimitPer10Min = Number(
    envTrim("REGISTER_RATE_LIMIT_PER_10MIN") ?? "50",
  );

  if (
    !Number.isInteger(registerRateLimitPer10Min) ||
    registerRateLimitPer10Min <= 0
  ) {
    throw internal("REGISTER_RATE_LIMIT_INVALID");
  }

  const allowedOrigins = parseAllowedOrigins(envTrim("APP_ALLOWED_ORIGINS"));
  const appBaseUrl = resolveAppBaseUrlFromRequest(req, allowedOrigins) ??
    envTrim("APP_BASE_URL");

  const config = {
    ...supabase,

    functionsBase: envTrim("FUNCTIONS_URL") ?? "",
    appBaseUrl: appBaseUrl ?? "",
    edgeServiceToken: envTrim("EDGE_SERVICE_TOKEN"),

    registerRateLimitPer10Min,

    turnstileSecret: envTrim("TURNSTILE_SECRET_KEY"),
    turnstileBypass: envTrim("TURNSTILE_BYPASS") === "1",
    debugErrors: envTrim("DEBUG_ERRORS") === "1",

    allowedOrigins,
  };

  if (!config.functionsBase || !config.appBaseUrl) {
    throw internal("CONFIG_MISSING");
  }

  assertFunctionsUrl(config.functionsBase, config.supabaseUrl);
  return config;
}
