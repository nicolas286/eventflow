import { startMollieConnectInputSchema, startMollieConnectResultSchema } from "../../../shared/schemas/mollie-connect.ts";
import { readLimitedJson, BodyTooLargeError } from "../_shared/app/request-body.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { assertMollieTestMode } from "../_shared/environment-safety.ts";
import { createClient } from "@supabase/supabase-js";

function corsHeaders(origin: string | null) {
  const allowed = (Deno.env.get("CORS_ALLOWED_ORIGINS") ?? "").split(",").map((s)=>s.trim()).filter(Boolean);
  // ✅ si pas d’allowlist, on refuse en prod (ou on fallback sur "*" si tu préfères)
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}
function json(req: Request, data: unknown, status = 200) {
  const origin = req.headers.get("origin");
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(origin)
    }
  });
}
function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function extractState(st: unknown) {
  // si ta RPC renvoie { state: "..." }
  if (typeof st === "object" && st !== null) {
    const o = Object.fromEntries(Object.entries(st));
    if (typeof o.state === "string" && o.state.trim()) return o.state;
  }
  // si ta RPC renvoie directement "state" (text)
  if (typeof st === "string" && st.trim()) return st;
  return null;
}
function normalizeOrigin(u: string) {
  const url = new URL(u);
  return `${url.protocol}//${url.host}`;
}
function resolveReturnBaseUrl(req: Request) {
  const allowed = (Deno.env.get("APP_ALLOWED_ORIGINS") ?? "").split(",").map((s)=>s.trim()).filter(Boolean).map((s)=>{
    try {
      return normalizeOrigin(s);
    } catch  {
      return "";
    }
  }).filter(Boolean);
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const o = normalizeOrigin(origin);
      if (allowed.includes(o)) return o;
    } catch { /* Invalid input or best-effort operation: handled by the following fallback. */ }
  }
  const ref = req.headers.get("referer");
  if (ref) {
    try {
      const o = normalizeOrigin(ref);
      if (allowed.includes(o)) return o;
    } catch { /* Invalid input or best-effort operation: handled by the following fallback. */ }
  }
  return null;
}
export const handler = createEdgeHandler({name: "mollie-connect-start", method: "POST", auth: "none"}, async ({req})=>{
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders(origin),
        "cache-control": "no-store"
      }
    });
  }
  try {
    if (req.method !== "POST") {
      return json(req, {
        error: "VALIDATION_ERROR: method_not_allowed"
      }, 405);
    }
    const token = getBearer(req);
    if (!token) return json(req, {
      error: "NOT_AUTHENTICATED"
    }, 401);
    const parsed = startMollieConnectInputSchema.safeParse(await readLimitedJson(req, 16384));
    if (!parsed.success) {
      return json(req, {
        error: "VALIDATION_ERROR: invalid_payload"
      }, 400);
    }
    const bodyRaw = parsed.data;
    assertMollieTestMode(bodyRaw.mode);
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const anonKey = (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim();
    const clientId = (Deno.env.get("MOLLIE_CONNECT_CLIENT_ID") ?? "").trim();
    const redirectUri = (Deno.env.get("MOLLIE_CONNECT_REDIRECT_URI") ?? "").trim();
    const scopes = (Deno.env.get("MOLLIE_CONNECT_SCOPES") ?? "").trim().replace(/\s+/g, " ");

    if (!supabaseUrl || !anonKey || !clientId || !redirectUri || !scopes) {
      return json(req, {
        error: "UNKNOWN: missing_env"
      }, 500);
    }
    
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });
    const { data: u, error: uErr } = await userClient.auth.getUser();
    if (uErr || !u?.user) return json(req, {
      error: "NOT_AUTHENTICATED"
    }, 401);
    const returnBaseUrl = resolveReturnBaseUrl(req);
    if (!returnBaseUrl) return json(req, {
      error: "ORIGIN_NOT_ALLOWED"
    }, 403);
    const { data: st, error: stErr } = await userClient.rpc("create_mollie_connect_state", {
      p_org_id: bodyRaw.orgId,
      p_mode: bodyRaw.mode,
      p_return_base_url: returnBaseUrl
    });
    // ✅ super important : laisse passer le message RPC brut
    if (stErr) {
      return json(req, {
        error: stErr.message
      }, 400);
    }
    const state = extractState(st);
    if (!state) return json(req, {
      error: "UNKNOWN: state_missing"
    }, 500);
    const url = new URL("https://my.mollie.com/oauth2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes);
    url.searchParams.set("state", state);
    url.searchParams.set("approval_prompt", "auto");
    url.searchParams.set("lang", "fr");
    if (bodyRaw.mode === "test") url.searchParams.set("testmode", "true");
    return json(req, startMollieConnectResultSchema.parse({
      ok: true,
      url: url.toString()
    }));
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json(req, {error: "PAYLOAD_TOO_LARGE"}, 413);
    if (e instanceof SyntaxError) return json(req, {error: "VALIDATION_ERROR: invalid_payload"}, 400);
    console.error("[mollie-connect-start] unexpected", e);
    return json(req, {
      error: "UNKNOWN: unexpected"
    }, 500);
  }
});

if (import.meta.main) Deno.serve(handler);
