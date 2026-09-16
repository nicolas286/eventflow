import { assertEquals } from "@std/assert";
import { resolveClientIp } from "../_shared/modules/client-ip/mod.ts";

function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : value;
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

async function signNetlifyPayload(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${base64Url(new Uint8Array(signature))}`;
}

Deno.test("client IP rejects untrusted proxy headers by default", async () => {
  const request = new Request("https://edge.test/register", {
    headers: {
      "cf-connecting-ip": "198.51.100.10",
      "x-forwarded-for": "203.0.113.20",
      "x-real-ip": "203.0.113.30",
    },
  });

  assertEquals(await resolveClientIp(request), null);
});

Deno.test("client IP trusts Cloudflare only when explicitly configured", async () => {
  const request = new Request("https://edge.test/register", {
    headers: {
      "cf-connecting-ip": "2001:db8::1",
      "x-forwarded-for": "203.0.113.20",
    },
  });

  assertEquals(
    await resolveClientIp(request, { trustCloudflareHeader: true }),
    { ip: "2001:db8::1", source: "cloudflare" },
  );
});

Deno.test("client IP accepts a Netlify address only with a valid signature", async () => {
  const secret = "netlify-test-secret";
  const now = new Date("2026-09-15T20:00:00.000Z");
  const signature = await signNetlifyPayload(
    {
      iss: "netlify",
      exp: Math.floor(now.getTime() / 1000) + 60,
      netlify_id: "eventflow-staging",
      site_url: "https://eventflow-staging.netlify.app",
    },
    secret,
  );
  const request = new Request("https://edge.test/register", {
    headers: {
      "x-nf-sign": signature,
      "x-nf-client-connection-ip": "198.51.100.42",
      "x-forwarded-for": "203.0.113.20",
    },
  });

  assertEquals(
    await resolveClientIp(request, {
      netlifySignatureSecret: secret,
      now,
    }),
    { ip: "198.51.100.42", source: "netlify" },
  );
  assertEquals(
    await resolveClientIp(request, {
      netlifySignatureSecret: "wrong-secret",
      now,
    }),
    null,
  );
});

Deno.test("unverified forwarded headers require an explicit local opt-in", async () => {
  const request = new Request("http://localhost/register", {
    headers: { "x-forwarded-for": "203.0.113.20, 10.0.0.1" },
  });

  assertEquals(
    await resolveClientIp(request, { allowUnverifiedProxyHeaders: true }),
    { ip: "203.0.113.20", source: "x-forwarded-for" },
  );
});
