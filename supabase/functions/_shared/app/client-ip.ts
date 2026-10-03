import { resolveClientIp } from "../modules/client-ip/mod.ts";
import type { EnvironmentReader } from "../modules/supabase-runtime/mod.ts";

export function resolveRequestClientIp(
  req: Request,
  environment: EnvironmentReader = Deno.env,
) {
  return resolveClientIp(req, {
    // Enable only behind an ingress that overwrites CF-Connecting-IP and
    // cannot be bypassed. A header (or a Netlify JWS not binding that header)
    // alone is not proof. Direct/local requests use the shared fallback.
    trustCloudflareHeader:
      environment.get("RATE_LIMIT_TRUST_CLOUDFLARE_IP") === "1",
  });
}
