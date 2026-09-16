import { forbidden, internal } from "../_shared/errors.ts";

export async function verifyTurnstile(opts) {
  const form = new URLSearchParams();
  form.set("secret", opts.secret);
  form.set("response", opts.token);
  if (opts.ip && opts.ip !== "unknown") {
    form.set("remoteip", opts.ip);
  }
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    },
  );
  if (!res.ok) {
    return {
      ok: false,
      error: "turnstile_verify_failed",
    };
  }
  const data = await res.json();
  return {
    ok: Boolean(data?.success),
    data,
  };
}
export async function verifyCaptchaOrThrow(opts) {
  if (opts.turnstileBypass && opts.token === "TEST_BYPASS") {
    return;
  }
  if (!opts.turnstileSecret) {
    throw internal("TURNSTILE_SECRET_MISSING");
  }
  const result = await verifyTurnstile({
    token: opts.token,
    ip: opts.ip,
    secret: opts.turnstileSecret,
  });
  if (!result.ok) {
    throw forbidden("CAPTCHA_FAILED");
  }
}
