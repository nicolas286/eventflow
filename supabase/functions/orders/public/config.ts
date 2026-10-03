import { assertTurnstileBypassAllowed } from "../../_shared/environment-safety.ts";
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

    appBaseUrl: appBaseUrl ?? "",

    stripeSecretKey: envTrim("STRIPE_SECRET_KEY"),
    stripePaymentMethodConfigurationId: envTrim(
      "STRIPE_PAYMENT_METHOD_CONFIGURATION_ID",
    ),
    eventPaymentProvider: envTrim("EVENT_PAYMENT_PROVIDER") ?? "stripe",

    registerRateLimitPer10Min,

    turnstileSecret: envTrim("TURNSTILE_SECRET_KEY"),
    turnstileBypass: envTrim("TURNSTILE_BYPASS") === "1",
    debugErrors: envTrim("DEBUG_ERRORS") === "1",

    allowedOrigins,
  };

  if (!config.appBaseUrl) {
    throw internal("CONFIG_MISSING");
  }

  if (config.turnstileBypass) assertTurnstileBypassAllowed();

  return config;
}
