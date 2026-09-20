import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
async function getMollieOrgId(accessToken: string) {
      const r = await fetch("https://api.mollie.com/v2/organizations/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      const j = await fetchJson(r);
      if (!j.ok) return {
        ok: false as const,
        error: "mollie_org_fetch_failed",
        reason: j.txt?.slice(0, 160) ?? `http_${j.status}`
      };
      const id = j.json?.id ? String(j.json.id) : null;
      if (!id) return {
        ok: false as const,
        error: "mollie_org_missing",
        reason: "no_org_id"
      };
      return {
        ok: true as const,
        id
      };
    }

async function getMollieProfileId(accessToken: string) {
      // 1) try /profiles/me
      const r1 = await fetch("https://api.mollie.com/v2/profiles/me", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      const j1 = await fetchJson(r1);
      if (j1.ok && j1.json?.id) {
        return {
          ok: true as const,
          id: String(j1.json.id)
        };
      }
      // 2) fallback /profiles (liste)
      const r2 = await fetch("https://api.mollie.com/v2/profiles", {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      });
      const j2 = await fetchJson(r2);
      if (!j2.ok) {
        return {
          ok: false as const,
          error: "mollie_profiles_fetch_failed",
          reason: (j1.txt?.slice(0, 120) ?? "") + " | " + (j2.txt?.slice(0, 160) ?? `http_${j2.status}`)
        };
      }
      const arr = j2.json?._embedded?.profiles ?? [];
      const picked = arr.find((p)=>String(p?.status ?? "").toLowerCase() === "verified" || String(p?.status ?? "").toLowerCase() === "enabled") ?? arr.find((p)=>Boolean(p?.id)) ?? null;
      const id = picked?.id ? String(picked.id) : null;
      if (!id) return {
        ok: false as const,
        error: "mollie_profile_missing",
        reason: "no_profile_in_list"
      };
      return {
        ok: true as const,
        id
      };
    }
import { z } from "zod";
const oauthProfileSchema = z.object({ id: z.string().optional(), status: z.string().optional() });
const oauthResponseSchema = oauthProfileSchema.extend({
  access_token: z.string().optional(), refresh_token: z.string().optional(),
  expires_in: z.union([z.number(), z.string()]).optional(), scope: z.string().optional(),
  _embedded: z.object({ profiles: z.array(oauthProfileSchema).optional() }).optional(),
});
import { assertMollieTestMode } from "../_shared/environment-safety.ts";
import { createClient } from "@supabase/supabase-js";
function redirect(url: string) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url,
      "cache-control": "no-store",
      "referrer-policy": "no-referrer"
    }
  });
}
async function fetchJson(res: Response) {
  const txt = await res.text();
  try {
    return {
      ok: res.ok,
      json: oauthResponseSchema.parse(JSON.parse(txt)),
      txt,
      status: res.status
    };
  } catch  {
    return {
      ok: res.ok,
      json: null,
      txt,
      status: res.status
    };
  }
}
function withQuery(base: string, params: Record<string, string>) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params))u.searchParams.set(k, v);
  return u.toString();
}
/* ---------------- ðŸ” Encryption helpers (AES-256-GCM, iv.ct) ---------------- */ function ub64(s: string) {
  return Uint8Array.from(atob(s), (c)=>c.charCodeAt(0));
}
function b64(bytes: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}
function loadEncConfig() {
  const json = (Deno.env.get("MOLLIE_TOKEN_ENC_KEYS_JSON") ?? "").trim();
  const activeKid = (Deno.env.get("MOLLIE_TOKEN_ENC_KID_ACTIVE") ?? "").trim();
  if (!json || !activeKid) throw new Error("MISSING_ENC_CONFIG");
  let keys: Record<string, string>;
  try {
    keys = z.record(z.string(), z.string()).parse(JSON.parse(json));
  } catch  {
    throw new Error("BAD_ENC_KEYS_JSON");
  }
  if (!keys[activeKid]) throw new Error("ACTIVE_KID_NOT_FOUND");
  return {
    keys,
    activeKid
  };
}
function importAesKey(base64Key: string) {
  const raw = ub64(base64Key);
  if (raw.byteLength !== 32) throw new Error("BAD_KEY_LENGTH");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt"
  ]);
}
async function encryptToken(plain: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv
  }, key, new TextEncoder().encode(plain));
  return `${b64(iv.buffer)}.${b64(ct)}`;
}
function toNonEmptyString(v: unknown) {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
}
export const handler = createEdgeHandler({name: "mollie-connect-callback", method: "GET", auth: "none"}, async ({req})=>{
  const returnPath = "/admin/structure";
  // Fallback uniquement (ne doit plus Ãªtre la source de vÃ©ritÃ©)
  const appBaseUrlFallback = (Deno.env.get("APP_BASE_URL") ?? "").trim();
  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    const clientId = (Deno.env.get("MOLLIE_CONNECT_CLIENT_ID") ?? "").trim();
    const clientSecret = (Deno.env.get("MOLLIE_CONNECT_CLIENT_SECRET") ?? "").trim();
    const redirectUri = (Deno.env.get("MOLLIE_CONNECT_REDIRECT_URI") ?? "").trim();
    // Pour les erreurs "early" (avant qu'on puisse consommer le state)
    const baseForEarlyErrors = appBaseUrlFallback || "https://eventflow-staging.netlify.app";
    if (!supabaseUrl || !serviceKey || !clientId || !clientSecret || !redirectUri) {
      return redirect(withQuery(`${baseForEarlyErrors}${returnPath}`, {
        connect: "0",
        error: "missing_env"
      }));
    }
    const url = new URL(req.url);
    const mollieError = url.searchParams.get("error");
    const mollieErrorDesc = url.searchParams.get("error_description");
    if (mollieError) {
      return redirect(withQuery(`${baseForEarlyErrors}${returnPath}`, {
        connect: "0",
        error: mollieError,
        reason: mollieErrorDesc ?? mollieError
      }));
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return redirect(withQuery(`${baseForEarlyErrors}${returnPath}`, {
        connect: "0",
        error: "missing_code_or_state"
      }));
    }
    const admin = createClient(supabaseUrl, serviceKey);
    // 1) consume state (org_id + user_id + mode + return_base_url)
    const { data: st, error: stErr } = await admin.rpc("consume_mollie_connect_state", {
      p_state: state
    });
    if (stErr || !st?.org_id) {
      return redirect(withQuery(`${baseForEarlyErrors}${returnPath}`, {
        connect: "0",
        error: "invalid_state",
        reason: stErr?.message ?? "no_org_id"
      }));
    }
    const orgId = String(st.org_id);
    const mode = st?.mode === "test" ? "test" : "live";
    assertMollieTestMode(mode);
    // âœ… source de vÃ©ritÃ© pour les redirects UI
    const returnBaseUrl = toNonEmptyString(st.return_base_url) ?? appBaseUrlFallback;
    if (!returnBaseUrl) {
      // On ne sait nulle part rediriger => hard fail
      return new Response("Server misconfigured", {
        status: 500,
        headers: {
          "cache-control": "no-store"
        }
      });
    }
    // 2) exchange code -> tokens
    const tokenRes = await fetch("https://api.mollie.com/oauth2/tokens", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret
      }).toString()
    });
    const tokenData = await fetchJson(tokenRes);
    if (!tokenData.ok) {
      console.error("[mollie-callback] token_exchange_failed", {
        status: tokenData.status,
        txt: tokenData.txt?.slice(0, 500)
      });
      return redirect(withQuery(`${returnBaseUrl}${returnPath}`, {
        connect: "0",
        error: "token_exchange_failed"
      }));
    }
    const accessToken = tokenData.json?.access_token;
    const refreshToken = tokenData.json?.refresh_token;
    const expiresIn = Number(tokenData.json?.expires_in ?? 0);
    const scope = tokenData.json?.scope;
    if (!accessToken || !refreshToken || !expiresIn) {
      return redirect(withQuery(`${returnBaseUrl}${returnPath}`, {
        connect: "0",
        error: "bad_token_payload"
      }));
    }
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();


    // --- usage ---
    const orgInfo = await getMollieOrgId(accessToken);
    if (!orgInfo.ok) {
      return redirect(withQuery(`${returnBaseUrl}${returnPath}`, {
        connect: "0",
        error: orgInfo.error,
        reason: orgInfo.reason
      }));
    }
    const profInfo = await getMollieProfileId(accessToken);
    if (!profInfo.ok) {
      return redirect(withQuery(`${returnBaseUrl}${returnPath}`, {
        connect: "0",
        error: profInfo.error,
        reason: profInfo.reason
      }));
    }
    const mollieOrgId = orgInfo.id;
    const mollieProfileId = profInfo.id;
    // 4) ðŸ” encrypt tokens (EDGE)
    let accessTokenEnc;
    let refreshTokenEnc;
    let encKid;
    try {
      const { keys, activeKid } = loadEncConfig();
      encKid = activeKid;
      const key = await importAesKey(keys[activeKid]);
      accessTokenEnc = await encryptToken(accessToken, key);
      refreshTokenEnc = await encryptToken(refreshToken, key);
    } catch (e) {
      return redirect(withQuery(`${returnBaseUrl}${returnPath}`, {
        connect: "0",
        error: "encryption_failed",
        reason: String(e).slice(0, 160)
      }));
    }
    // 5) upsert DB (ciphertext only)
    const { error: upErr } = await admin.rpc("upsert_organization_mollie_connect", {
      p_input: {
        org_id: orgId,
        mode,
        access_token_enc: accessTokenEnc,
        refresh_token_enc: refreshTokenEnc,
        enc_kid: encKid,
        enc_alg: "A256GCM",
        access_token_expires_at: expiresAt,
        scopes: scope ?? null,
        mollie_organization_id: mollieOrgId,
        mollie_profile_id: mollieProfileId
      }
    });
    if (upErr) {
      return redirect(withQuery(`${returnBaseUrl}${returnPath}`, {
        connect: "0",
        error: "db_upsert_failed",
        reason: upErr.message
      }));
    }
    // 6) reflect in organizations
    const { error: orgUpErr } = await admin.from("organizations").update({
      payments_provider: "mollie",
      payments_status: "connected",
      payments_live_ready: mode === "live"
    }).eq("id", orgId);
    if (orgUpErr) {
      return redirect(withQuery(`${returnBaseUrl}${returnPath}`, {
        connect: "0",
        error: "db_org_update_failed",
        reason: orgUpErr.message
      }));
    }
    return redirect(withQuery(`${returnBaseUrl}${returnPath}`, {
      connect: "1"
    }));
  } catch (e) {
    console.error("[mollie-connect-callback] unexpected", e);
    const fallback = (Deno.env.get("APP_BASE_URL") ?? "").trim() || "https://staging.eventflow.be";
    return redirect(withQuery(`${fallback}/admin/structure`, {
      connect: "0",
      error: "unexpected"
    }));
  }
});

if (import.meta.main) Deno.serve(handler);
