import { isIP } from "node:net";

const NETLIFY_CLIENT_IP_HEADER = "x-nf-client-connection-ip";
const NETLIFY_SIGNATURE_HEADER = "x-nf-sign";
const MAX_JWS_LENGTH = 4096;

export type ClientIpSource =
  | "netlify"
  | "cloudflare"
  | "x-forwarded-for"
  | "x-real-ip";

export type ResolvedClientIp = {
  ip: string;
  source: ClientIpSource;
};

export type ResolveClientIpOptions = {
  allowUnverifiedProxyHeaders?: boolean;
  trustCloudflareHeader?: boolean;
  netlifySignatureSecret?: string | null;
  now?: Date;
};

type NetlifySignaturePayload = {
  exp?: unknown;
  iss?: unknown;
  netlify_id?: unknown;
  site_url?: unknown;
};

function normalizeIp(value: string | null): string | null {
  const candidate = value?.trim() ?? "";

  if (
    !candidate || candidate.length > 45 || candidate.includes(",") ||
    candidate.includes("%")
  ) {
    return null;
  }

  const version = isIP(candidate);
  if (version === 4) {
    return candidate.split(".").map((part) => String(Number(part))).join(".");
  }

  if (version === 6) {
    try {
      return new URL(`http://[${candidate}]/`).hostname.slice(1, -1);
    } catch {
      return null;
    }
  }

  return null;
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;

  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );

  try {
    const decoded = atob(base64);
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function decodeJsonPart(value: string): Record<string, unknown> | null {
  const decoded = decodeBase64Url(value);
  if (!decoded) return null;

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decoded));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function isValidNetlifySignature(
  token: string,
  secret: string,
  now: Date,
): Promise<boolean> {
  if (!token || token.length > MAX_JWS_LENGTH || !secret) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  if (decodeJsonPart(encodedHeader)?.alg !== "HS256") return false;

  const signature = decodeBase64Url(encodedSignature);
  if (!signature || signature.byteLength !== 32) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    encoder.encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!valid) return false;

  const payload = decodeJsonPart(encodedPayload) as
    | NetlifySignaturePayload
    | null;
  return payload?.iss === "netlify" &&
    typeof payload.exp === "number" && Number.isFinite(payload.exp) &&
    payload.exp * 1000 > now.getTime() &&
    typeof payload.netlify_id === "string" && payload.netlify_id.length > 0 &&
    typeof payload.site_url === "string" &&
    payload.site_url.startsWith("https://");
}

function resolveUnverifiedProxyIp(req: Request): ResolvedClientIp | null {
  const forwardedIp = normalizeIp(
    req.headers.get("x-forwarded-for")?.split(",").at(0) ?? null,
  );
  if (forwardedIp) return { ip: forwardedIp, source: "x-forwarded-for" };

  const realIp = normalizeIp(req.headers.get("x-real-ip"));
  return realIp ? { ip: realIp, source: "x-real-ip" } : null;
}

export async function resolveClientIp(
  req: Request,
  options: ResolveClientIpOptions = {},
): Promise<ResolvedClientIp | null> {
  const netlifySignature = req.headers.get(NETLIFY_SIGNATURE_HEADER);
  const netlifySignatureSecret = options.netlifySignatureSecret ?? null;

  if (
    netlifySignatureSecret && netlifySignature &&
    await isValidNetlifySignature(
      netlifySignature,
      netlifySignatureSecret,
      options.now ?? new Date(),
    )
  ) {
    const netlifyClientIp = normalizeIp(
      req.headers.get(NETLIFY_CLIENT_IP_HEADER),
    );
    if (netlifyClientIp) {
      return { ip: netlifyClientIp, source: "netlify" };
    }
  }

  const cloudflareClientIp = options.trustCloudflareHeader
    ? normalizeIp(req.headers.get("cf-connecting-ip"))
    : null;
  if (cloudflareClientIp) {
    return { ip: cloudflareClientIp, source: "cloudflare" };
  }

  return options.allowUnverifiedProxyHeaders
    ? resolveUnverifiedProxyIp(req)
    : null;
}

export async function getClientIp(
  req: Request,
  options: ResolveClientIpOptions = {},
): Promise<string | null> {
  return (await resolveClientIp(req, options))?.ip ?? null;
}
