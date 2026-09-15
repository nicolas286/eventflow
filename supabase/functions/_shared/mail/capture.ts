import { isRestrictedEnvironment } from "../environment-safety.ts";

export function isMailCaptureEnabled() {
  return isRestrictedEnvironment() && Deno.env.get("MAIL_MODE") === "capture";
}

export async function captureMail(payload: unknown) {
  if (!isMailCaptureEnabled()) throw new Error("MAIL_CAPTURE_DISABLED");
  const base = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!base || !key) throw new Error("MAIL_CAPTURE_CONFIG_MISSING");
  const id = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.json`;
  const response = await fetch(`${base}/storage/v1/object/mail-previews/${id}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "content-type": "application/json" },
    body: JSON.stringify({ capturedAt: new Date().toISOString(), payload }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("MAIL_CAPTURE_FAILED");
  return { ok: true as const, provider: "capture" as const, id };
}
