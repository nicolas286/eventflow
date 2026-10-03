import { internal } from "./errors.ts";

const productionOrigin = "https://dixirvllhfkvqoahhfqh.supabase.co";

export function isRestrictedEnvironment() {
  const url = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const environment = Deno.env.get("APP_ENV");
  // Preserve the existing production configuration; every other project fails closed.
  if (environment === "production" && url !== productionOrigin) {
    throw new Error("ENVIRONMENT_PROJECT_MISMATCH");
  }
  if (environment === "staging" && url === productionOrigin)
    throw new Error("ENVIRONMENT_PROJECT_MISMATCH");
  return environment === "staging" || url !== productionOrigin;
}

export function assertMollieTestMode(mode: unknown) {
  if (isRestrictedEnvironment() && mode !== "test")
    throw new Error("LIVE_PAYMENTS_DISABLED");
}

export function assertMollieApiKey(key: string | null | undefined) {
  if (isRestrictedEnvironment() && !key?.startsWith("test_"))
    throw new Error("LIVE_PAYMENTS_DISABLED");
}

export function assertStripeApiKey(key: string | null | undefined) {
  const restricted = isRestrictedEnvironment();
  const isTest = key?.startsWith("sk_test_") || key?.startsWith("rk_test_");
  const isLive = key?.startsWith("sk_live_") || key?.startsWith("rk_live_");

  if (restricted && !isTest) throw new Error("LIVE_PAYMENTS_DISABLED");
  if (!restricted && !isLive) throw new Error("TEST_PAYMENTS_DISABLED");
}

export function assertStripeWebhookMode(livemode: boolean) {
  if (isRestrictedEnvironment() && livemode) {
    throw new Error("LIVE_PAYMENTS_DISABLED");
  }
  if (!isRestrictedEnvironment() && !livemode) {
    throw new Error("TEST_PAYMENTS_DISABLED");
  }
}

export function assertMailRecipients(recipients: string | string[]) {
  if (!isRestrictedEnvironment()) return;
  const allowed = (Deno.env.get("MAIL_ALLOWED_RECIPIENTS") ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const values = Array.isArray(recipients) ? recipients : [recipients];
  if (
    !values.length ||
    values.some((value) => !allowed.includes(value.trim().toLowerCase()))
  ) {
    throw new Error("MAIL_RECIPIENT_NOT_ALLOWED");
  }
}

export function assertBillitEnabled() {
  // No staging Peppol transmission until a separate sandbox integration is implemented.
  if (isRestrictedEnvironment()) throw new Error("BILLIT_DISABLED_IN_STAGING");
}

export function assertFunctionsUrl(functionsUrl: string, supabaseUrl: string) {
  if (
    isRestrictedEnvironment() &&
    functionsUrl.replace(/\/+$/, "") !==
      `${supabaseUrl.replace(/\/+$/, "")}/functions/v1`
  ) {
    throw new Error("CROSS_PROJECT_FUNCTIONS_URL");
  }
}

/** Restricted payments alone do not authorize skipping CAPTCHA. */
export function assertTurnstileBypassAllowed() {
  const environment = Deno.env.get("APP_ENV");
  let url: URL;
  try {
    if (!isRestrictedEnvironment() || environment === "production") {
      throw new Error("PRODUCTION");
    }
    url = new URL(Deno.env.get("SUPABASE_URL") ?? "");
    if (url.hostname === new URL(productionOrigin).hostname) {
      throw new Error("PRODUCTION");
    }
  } catch {
    throw internal("TURNSTILE_BYPASS_FORBIDDEN");
  }
  const local =
    ["localhost", "127.0.0.1", "[::1]", "kong"].includes(url.hostname) &&
    ["http:", "https:"].includes(url.protocol);
  const staging = environment === "staging" && url.protocol === "https:" &&
    url.hostname.endsWith(".supabase.co");
  const localEnvironment = !environment ||
    ["local", "development", "staging"].includes(environment);
  if (!staging && !(local && localEnvironment)) {
    throw internal("TURNSTILE_BYPASS_FORBIDDEN");
  }
}
