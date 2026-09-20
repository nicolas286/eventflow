import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { z } from "zod";
import { assertMollieTestMode } from "../_shared/environment-safety.ts";
import { sendOrderConfirmation } from "../_shared/services/order-confirmation/index.ts";
import { createConsoleLogger } from "../_shared/modules/logger/mod.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
type ConfirmationMailEdgeOptions = { admin: SupabaseClient; functionsBase: string; edgeServiceToken: string; orderId: string; };
async function sendConfirmationMailViaEdge(opts: ConfirmationMailEdgeOptions) {
 await sendOrderConfirmation(opts.admin, createConsoleLogger("order-confirmation"), opts.orderId);
}
async function trySendOrderConfirmationEmail(opts: ConfirmationMailEdgeOptions) {
  // 1) claim (idempotence)
  const { data: claimRows, error: claimErr } = await opts.admin.rpc("claim_order_confirmation_email", {
    p_order_id: opts.orderId
  });
  if (claimErr) {
    console.error("[webhook] claim_order_confirmation_email failed", claimErr);
    try {
      await opts.admin.rpc("mark_order_confirmation_email_error", {
        p_order_id: opts.orderId,
        p_error: "CLAIM_FAILED"
      });
    } catch { /* Invalid input or best-effort operation: handled by the following fallback. */ }
    return;
  }
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim?.ok) return; // déjà envoyé / déjà claim
  // 2) call central template
  try {
    await sendConfirmationMailViaEdge({
      admin: opts.admin,
      functionsBase: opts.functionsBase,
      edgeServiceToken: opts.edgeServiceToken,
      orderId: opts.orderId
    });
    await opts.admin.rpc("mark_order_confirmation_email_sent", {
      p_order_id: opts.orderId
    });
  } catch (e) {
    console.error("[webhook] confirmation send failed", e);
    try {
      await opts.admin.rpc("mark_order_confirmation_email_error", {
        p_order_id: opts.orderId,
        p_error: "SEND_FAILED"
      });
    } catch { /* Invalid input or best-effort operation: handled by the following fallback. */ }
  }
}
function envTrim(name: string) {
  const v = Deno.env.get(name);
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
async function parseWebhookPaymentId(req: Request) {
  const raw = await req.text().catch(()=>"");
  if (!raw) return null;
  // try json
  try {
    const j = JSON.parse(raw);
    const id = j?.id;
    return typeof id === "string" ? id : null;
  } catch { /* Invalid input or best-effort operation: handled by the following fallback. */ }
  // fallback urlencoded
  const params = new URLSearchParams(raw);
  const id = params.get("id");
  return typeof id === "string" ? id : null;
}
function toCents(value: unknown) {
  const n = Number.parseFloat(String(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}
function isExpired(expiresAtIso: string | null) {
  if (!expiresAtIso) return true;
  const t = Date.parse(expiresAtIso);
  if (!Number.isFinite(t)) return true;
  return t - Date.now() < 60_000;
}
/* ---------------- 🔐 Encryption helpers (AES-256-GCM, iv.ct) ---------------- */ function ub64(s: string) {
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
async function decryptToken(enc: string, key: CryptoKey) {
  const parts = String(enc ?? "").split(".");
  if (parts.length !== 2) throw new Error("BAD_CIPHERTEXT_FORMAT");
  const iv = ub64(parts[0]);
  const ct = ub64(parts[1]);
  const pt = await crypto.subtle.decrypt({
    name: "AES-GCM",
    iv
  }, key, ct);
  return new TextDecoder().decode(pt);
}
async function encryptToken(plain: string, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv
  }, key, new TextEncoder().encode(plain));
  return `${b64(iv.buffer)}.${b64(ct)}`;
}
/* ---------------- mollie helpers ---------------- */ async function refreshMollieAccessToken(refreshToken: string) {
  const clientId = envTrim("MOLLIE_CONNECT_CLIENT_ID");
  const clientSecret = envTrim("MOLLIE_CONNECT_CLIENT_SECRET");
  const redirectUri = envTrim("MOLLIE_CONNECT_REDIRECT_URI");
  if (!clientId || !clientSecret || !redirectUri) return {
    ok: false as const,
    error: "connect_client_missing"
  };
  const res = await fetch("https://api.mollie.com/oauth2/tokens", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri
    }).toString()
  });
  const txt = await res.text().catch(()=>"");
  let j: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(txt);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) j = Object.fromEntries(Object.entries(parsed));
  } catch { /* Invalid input or best-effort operation: handled by the following fallback. */ }
  if (!res.ok) return {
    ok: false as const,
    error: "refresh_failed",
    details: txt
  };
  const accessToken = typeof j?.access_token === "string" ? j.access_token : null;
  const newRefresh = typeof j?.refresh_token === "string" ? j.refresh_token : refreshToken;
  const expiresIn = Number(j?.expires_in ?? 0);
  const scope = typeof j?.scope === "string" ? j.scope : null;
  if (!accessToken || !expiresIn) return {
    ok: false as const,
    error: "refresh_bad_payload",
    details: j
  };
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  return {
    ok: true as const,
    accessToken,
    refreshToken: newRefresh,
    expiresAt,
    scope
  };
}
function mapMollieStatusToDb(status: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "paid") return "paid";
  if (s === "failed") return "failed";
  if (s === "canceled") return "canceled";
  if (s === "expired") return "expired";
  if (s === "pending") return "pending";
  return "pending";
}
function fetchMolliePayment(paymentId: string, accessToken: string, isTest: boolean) {
  const url = `https://api.mollie.com/v2/payments/${paymentId}${isTest ? "?testmode=true" : ""}`;
  return fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });
}
export const handler = createEdgeHandler({name: "mollie-webhook", method: "POST", auth: "none", methodNotAllowedResponse: () => json({ok:true},200)}, async ({req})=>{
  // Toujours 200 pour Mollie
  try {
    if (req.method === "OPTIONS") return json({
      ok: true
    }, 200);
    if (req.method !== "POST") return json({
      ok: true
    }, 200);
    const functionsBase = envTrim("FUNCTIONS_URL");
    const appBaseUrl = envTrim("APP_BASE_URL");
    const edgeToken = envTrim("EDGE_SERVICE_TOKEN");
    if (!functionsBase || !appBaseUrl || !edgeToken) {
      console.error("[webhook] missing env for email confirmation");
    // on continue quand même: webhook ne doit jamais planter
    }
    const supabaseUrl = envTrim("SUPABASE_URL");
    const serviceKey = envTrim("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("[webhook] missing env supabase");
      return json({
        ok: true
      }, 200);
    }
    const paymentId = await parseWebhookPaymentId(req);
    if (!paymentId || !paymentId.startsWith("tr_")) {
      console.error("[webhook] invalid payment id");
      return json({
        ok: true
      }, 200);
    }
    const admin = createClient(supabaseUrl, serviceKey);
    // 1) provider_payment_id -> order_id
    const { data: pRow, error: pErr } = await admin.from("payments").select("order_id").eq("provider", "mollie").eq("provider_payment_id", paymentId).maybeSingle();
    if (pErr || !pRow?.order_id) return json({
      ok: true
    }, 200);
    const orderId = pRow.order_id;
    // 2) order -> event -> org
    const { data: oRow } = await admin.from("orders").select("event_id").eq("id", orderId).maybeSingle();
    if (!oRow?.event_id) return json({
      ok: true
    }, 200);
    const { data: eRow } = await admin.from("events").select("org_id").eq("id", oRow.event_id).maybeSingle();
    if (!eRow?.org_id) return json({
      ok: true
    }, 200);
    const orgId = eRow.org_id;
    // 3) connect tokens (ciphertext)
    const { data: mcRows, error: mcErr } = await admin.rpc("get_org_mollie_connect_secrets", {
      p_org_id: orgId
    });
    const mc = Array.isArray(mcRows) ? mcRows[0] : null;
    if (mcErr || !mc || mc.status !== "connected") return json({
      ok: true
    }, 200);
    const accessEnc = mc.access_token_enc;
    const refreshEnc = mc.refresh_token_enc;
    const kid = mc.enc_kid;
    if (!accessEnc || !refreshEnc || !kid) return json({
      ok: true
    }, 200);
    // decrypt
    let accessToken;
    let refreshToken;
    try {
      const { keys } = loadEncConfig();
      const keyB64 = keys[kid];
      if (!keyB64) return json({
        ok: true
      }, 200);
      const key = await importAesKey(keyB64);
      accessToken = await decryptToken(accessEnc, key);
      refreshToken = await decryptToken(refreshEnc, key);
    } catch (e) {
      console.error("[webhook] token decrypt failed", e);
      return json({
        ok: true
      }, 200);
    }
    // refresh if expired
    if (isExpired(mc.access_token_expires_at)) {
      const ref = await refreshMollieAccessToken(refreshToken);
      if (ref.ok) {
        accessToken = ref.accessToken;
        refreshToken = ref.refreshToken;
        // encrypt with active key
        try {
          const { keys, activeKid } = loadEncConfig();
          const key = await importAesKey(keys[activeKid]);
          const newAccessEnc = await encryptToken(ref.accessToken, key);
          const newRefreshEnc = await encryptToken(ref.refreshToken, key);
          await admin.rpc("update_org_mollie_tokens", {
            p_org_id: orgId,
            p_access_token_enc: newAccessEnc,
            p_refresh_token_enc: newRefreshEnc,
            p_enc_kid: activeKid,
            p_enc_alg: "A256GCM",
            p_expires_at: ref.expiresAt,
            p_scopes: ref.scope ?? mc.scopes ?? null
          });
        } catch (e) {
          console.error("[webhook] token refresh encrypt/update failed", e);
        }
      }
    }
    assertMollieTestMode(mc.mode);
    const isTest = mc.mode === "test";
    // 4) fetch Mollie payment (truth source)
    const paymentRes = await fetchMolliePayment(paymentId, accessToken, isTest);
    if (!paymentRes.ok) return json({
      ok: true
    }, 200);
    const payment = await paymentRes.json();
    const mollieStatus = String(payment?.status ?? "open");
    const dbStatus = mapMollieStatusToDb(mollieStatus);
    // 5) update payments row (NE PAS setter processed_at ici)
    await admin.from("payments").update({
      status: dbStatus,
      raw: payment,
      updated_at: new Date().toISOString()
    }).eq("provider", "mollie").eq("provider_payment_id", paymentId);
    // 6) stop if not paid
    if (mollieStatus !== "paid") return json({
      ok: true
    }, 200);
    const amountCents = toCents(payment?.amount?.value);
    const currency = payment?.amount?.currency;
    if (!amountCents || !currency) return json({
      ok: true
    }, 200);
    // 7) apply payment
    const { error: rpcErr } = await admin.rpc("apply_order_payment", {
      p_order_id: orderId,
      p_provider: "mollie",
      p_amount_cents: amountCents,
      p_currency: currency,
      p_provider_payment_id: paymentId,
      p_raw: payment,
      p_note: null
    });
    if (rpcErr) console.error("[webhook] apply_order_payment failed", rpcErr);
    // 8) confirmation email (best effort, idempotent)
    if (!rpcErr && functionsBase && edgeToken) {
      try {
        await trySendOrderConfirmationEmail({
          admin,
          orderId,
          functionsBase,
          edgeServiceToken: edgeToken
        });
      } catch (e) {
        console.error("[webhook] trySendOrderConfirmationEmail crashed (ignored)", e);
      }
    }
    return json({
      ok: true
    }, 200);
  } catch (e) {
    console.error("[webhook] unexpected", e);
    return json({
      ok: true
    }, 200);
  }
});

if (import.meta.main) Deno.serve(handler);
