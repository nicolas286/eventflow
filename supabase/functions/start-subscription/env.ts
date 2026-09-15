import { assertMollieApiKey } from "../_shared/environment-safety.ts";
function envTrim(name: string) {
  const v = Deno.env.get(name);
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}

export function loadEnv() {
  const supabaseUrl = envTrim("SUPABASE_URL");
  const serviceKey = envTrim("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = envTrim("SUPABASE_ANON_KEY");
  const mollieKey = envTrim("MOLLIE_API_KEY");
  assertMollieApiKey(mollieKey);

  if (!supabaseUrl || !serviceKey || !anonKey || !mollieKey) {
    return null;
  }

  return {
    supabaseUrl,
    serviceKey,
    anonKey,
    mollieKey,
    functionsBase: `${supabaseUrl}/functions/v1`,
  };
}

function normalizeOrigin(u: string) {
  const url = new URL(u);
  return `${url.protocol}//${url.host}`;
}

export function resolveReturnBaseUrl(req: Request) {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return normalizeOrigin(s);
      } catch {
        return "";
      }
    })
    .filter(Boolean);

  if (allowed.length === 0) return null;

  const origin = req.headers.get("origin");

  if (origin) {
    try {
      const o = normalizeOrigin(origin);
      if (allowed.includes(o)) return o;
    } catch {}
  }

  const ref = req.headers.get("referer");

  if (ref) {
    try {
      const o = normalizeOrigin(ref);
      if (allowed.includes(o)) return o;
    } catch {}
  }

  return null;
}