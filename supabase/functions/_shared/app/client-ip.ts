import { resolveClientIp } from "../modules/client-ip/mod.ts";
import type { EnvironmentReader } from "../modules/supabase-runtime/mod.ts";

export function resolveRequestClientIp(
  req: Request,
  environment: EnvironmentReader = Deno.env,
) {
  return resolveClientIp(req, {
    netlifySignatureSecret: environment.get("NETLIFY_PROXY_SIGNATURE_SECRET"),
    trustCloudflareHeader: true,
  });
}
