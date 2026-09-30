import type { SupabaseClient, User } from "@supabase/supabase-js";
import { parseBearerToken } from "../_shared/modules/supabase-auth/mod.ts";
import { forbidden, unauthorized } from "../_shared/errors.ts";

type AuthenticationMethod = {
  method?: unknown;
  timestamp?: unknown;
};

export type PlatformJwtClaims = {
  aal: "aal1" | "aal2";
  sessionId: string;
  authenticationMethods: Array<{ method: string; timestamp: number }>;
};

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  return atob(padded);
}

function parseClaims(accessToken: string): PlatformJwtClaims {
  const parts = accessToken.split(".");
  if (parts.length !== 3) throw unauthorized("PLATFORM_INVALID_SESSION");

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
  } catch {
    throw unauthorized("PLATFORM_INVALID_SESSION");
  }

  const aal = raw.aal;
  const sessionId = raw.session_id;
  if ((aal !== "aal1" && aal !== "aal2") || typeof sessionId !== "string") {
    throw unauthorized("PLATFORM_INVALID_SESSION");
  }

  const authenticationMethods = Array.isArray(raw.amr)
    ? (raw.amr as AuthenticationMethod[]).flatMap((entry) =>
      typeof entry?.method === "string" &&
        typeof entry.timestamp === "number" &&
        Number.isFinite(entry.timestamp)
        ? [{ method: entry.method, timestamp: entry.timestamp }]
        : []
    )
    : [];

  return { aal, sessionId, authenticationMethods };
}

export async function resolvePlatformAccess(input: {
  req: Request;
  user: User;
  serviceClient: SupabaseClient;
  requireAal2?: boolean;
}) {
  const authorization = input.req.headers.get("authorization");
  if (!authorization) throw unauthorized("PLATFORM_INVALID_SESSION");

  // createEdgeHandler has already validated this exact bearer token with
  // Supabase Auth. Decoding here only reads trusted claims from that token.
  const claims = parseClaims(parseBearerToken(authorization));
  const { data, error } = await input.serviceClient.rpc(
    "platform_admin_access_state",
    {
      p_user_id: input.user.id,
      p_session_id: claims.sessionId,
    },
  );
  if (error || !data || typeof data !== "object") {
    throw unauthorized("PLATFORM_INVALID_SESSION");
  }

  const state = data as Record<string, unknown>;
  if (state.sessionActive !== true) {
    throw unauthorized("PLATFORM_SESSION_REVOKED");
  }
  if (state.isPlatformAdmin !== true) {
    throw forbidden("PLATFORM_FORBIDDEN");
  }
  if (input.requireAal2 !== false && claims.aal !== "aal2") {
    throw forbidden("PLATFORM_MFA_REQUIRED");
  }

  return claims;
}

export function assertRecentTotp(
  claims: PlatformJwtClaims,
  maxAgeSeconds = 120,
) {
  const newestTotp = claims.authenticationMethods
    .filter((entry) => entry.method === "totp")
    .reduce((latest, entry) => Math.max(latest, entry.timestamp), 0);
  const nowSeconds = Math.floor(Date.now() / 1000);

  if (newestTotp <= 0 || nowSeconds - newestTotp > maxAgeSeconds) {
    throw forbidden("PLATFORM_RECENT_MFA_REQUIRED");
  }
}

export function randomStepUpToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}
