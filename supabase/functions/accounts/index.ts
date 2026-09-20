import { z } from "zod";
import { assertMollieApiKey } from "../_shared/environment-safety.ts";
// supabase/functions/delete-account/index.ts
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { deleteAccountInputSchema } from "../../../shared/schemas/accounts.ts";
import { authorizeAccountOrganization } from "./authorization.ts";
import { readLimitedJson, BodyTooLargeError } from "../_shared/app/request-body.ts";
/* --------- 🌐 CORS + JSON helpers -------- */ const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400"
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function envTrim(name: string) {
  const v = Deno.env.get(name);
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}

/* --------- 💳 Mollie helpers (copie MVP de cancel-subscription) -------- */ async function mollieFetch(url: string, mollieKey: string, init: RequestInit) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${mollieKey}`,
      "Content-Type": "application/json",
      ...init.headers ?? {}
    }
  });
  const txt = await res.text().catch(()=>"");
  let data: { id?: string; status?: string } | null = null;
  try {
    data = txt ? z.object({ id: z.string().optional(), status: z.string().optional() }).parse(JSON.parse(txt)) : null;
  } catch  {
    data = null;
  }
  return {
    res,
    data,
    rawText: txt
  };
}
function isMollieCancelErr(r: Awaited<ReturnType<typeof cancelSubscriptionStrict>>): r is Extract<Awaited<ReturnType<typeof cancelSubscriptionStrict>>, { ok: false }> {
  return r.ok === false;
}
async function getExistingSubscription(params: { mollieKey: string; customerId: string; subscriptionId: string }) {
  const { mollieKey, customerId, subscriptionId } = params;
  const { res, data, rawText } = await mollieFetch(`https://api.mollie.com/v2/customers/${customerId}/subscriptions/${subscriptionId}`, mollieKey, {
    method: "GET"
  });
  if (res.status === 404) {
    return {
      ok: false as const,
      error: "MOLLIE_SUB_404_WRONG_MAPPING",
      details: rawText
    };
  }
  if (!res.ok) {
    return {
      ok: false as const,
      error: "MOLLIE_SUB_FETCH_FAILED",
      details: rawText
    };
  }
  const id = typeof data?.id === "string" ? data.id : null;
  if (!id || id !== subscriptionId) {
    return {
      ok: false as const,
      error: "MOLLIE_SUB_ID_MISMATCH"
    };
  }
  return {
    ok: true as const,
    subscription: data
  };
}
async function cancelSubscriptionStrict(params: { mollieKey: string; customerId: string; subscriptionId: string }) {
  const { mollieKey, customerId, subscriptionId } = params;
  const got = await getExistingSubscription({
    mollieKey,
    customerId,
    subscriptionId
  });
  if (got.ok === false) {
    return {
      ok: false as const,
      error: got.error,
      details: got.details
    };
  }
  const status = String(got.subscription?.status ?? "").toLowerCase();
  if (status === "canceled" || status === "cancelled" || status === "completed" || status === "terminated") {
    return {
      ok: true as const,
      alreadyCanceled: true
    };
  }
  const { res, rawText } = await mollieFetch(`https://api.mollie.com/v2/customers/${customerId}/subscriptions/${subscriptionId}`, mollieKey, {
    method: "DELETE"
  });
  if (res.status === 404) {
    return {
      ok: false as const,
      error: "MOLLIE_CANCEL_404_AFTER_GET",
      details: rawText
    };
  }
  if (!res.ok) {
    return {
      ok: false as const,
      error: "MOLLIE_CANCEL_SUB_FAILED",
      details: rawText
    };
  }
  return {
    ok: true as const,
    alreadyCanceled: false
  };
}
/* --------- 🧨 delete-account -------- */ export const handler = createEdgeHandler({
  name: "accounts", method: "DELETE", auth: "required", serviceClient: true,
  authenticationRequiredResponse: (req) => json({ error: req.headers.get("authorization") ? "Invalid session" : "Missing Authorization bearer token" }, 401),
}, async ({ req, user, serviceClient: service })=>{
  try {
    if (!new URL(req.url).pathname.endsWith("/accounts/me")) return json({ error: "Not found" }, 404);
    const parsed = deleteAccountInputSchema.safeParse(await readLimitedJson(req, 16384));
    if (!parsed.success) return json({ error: "Invalid payload" }, 400);
    const maybeOrgId = parsed.data.orgId;
    const mollieKey = envTrim("MOLLIE_API_KEY");
    assertMollieApiKey(mollieKey);
    if (!mollieKey) {
      return json({
        error: "Server misconfigured"
      }, 500);
    }
    const userId = user.id;
    const authorization = await authorizeAccountOrganization(service, userId, maybeOrgId);
    if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
    const orgId = authorization.orgId;
    // 4) Load current subscription mapping
    const { data: subRow, error: subErr } = await service.from("subscriptions").select("org_id, status, plan, mollie_customer_id, mollie_subscription_id").eq("org_id", orgId).maybeSingle();
    if (subErr) return json({
      error: "Load subscriptions failed"
    }, 500);
    const mollieCustomerId = subRow?.mollie_customer_id ?? null;
    const mollieSubscriptionId = subRow?.mollie_subscription_id ?? null;
    // 5) Cancel subscription (strict) - si mapping existe, doit réussir
    let mollieAction = "skipped";
    if (mollieCustomerId && mollieSubscriptionId) {
      const cancel = await cancelSubscriptionStrict({
        mollieKey,
        customerId: mollieCustomerId,
        subscriptionId: mollieSubscriptionId
      });
      if (isMollieCancelErr(cancel)) {
        console.error("[delete-account] mollie cancel failed", {
          orgId,
          userId,
          error: cancel.error,
          details: cancel.details
        });
        return json({
          error: cancel.error
        }, 502);
      }
      mollieAction = cancel.alreadyCanceled ? "already_canceled" : "canceled";
    }
    // 6) DB: suspend org (+ free) + delete subscription row
    const nowIso = new Date().toISOString();
    const { error: orgUpErr } = await service.from("organizations").update({
      status: "suspended",
      plan: "free",
      plan_started_at: nowIso,
      plan_expires_at: null,
      updated_at: nowIso
    }).eq("id", orgId);
    if (orgUpErr) return json({
      error: "DB_ORG_UPDATE_FAILED"
    }, 500);
    const { error: delSubErr } = await service.from("subscriptions").delete().eq("org_id", orgId);
    if (delSubErr) return json({
      error: "DB_SUB_DELETE_FAILED"
    }, 500);
    // 7) Delete auth user (cascade profiles via FK)
    const { error: delUserErr } = await service.auth.admin.deleteUser(userId);
    if (delUserErr) {
      console.error("[delete-account] deleteUser failed", {
        orgId,
        userId,
        message: delUserErr.message,
        name: delUserErr?.name ?? null,
        status: delUserErr?.status ?? null,
        cause: delUserErr?.cause ?? null,
        stack: delUserErr?.stack ?? null
      });
      return json({
        ok: false as const,
        error: "AUTH_DELETE_FAILED",
        details: delUserErr.message ?? null
      }, 500);
    }
    // ✅ IMPORTANT: répondre au client, sinon 502 + CORS missing
    return json({
      ok: true as const,
      orgId,
      userId,
      mollieAction,
      previous: subRow ? {
        status: subRow.status ?? null,
        plan: subRow.plan ?? null
      } : null
    });
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json({ error: "PAYLOAD_TOO_LARGE" }, 413);
    if (e instanceof SyntaxError) return json({ error: "Invalid payload" }, 400);
    console.error("[delete-account] unexpected", e);
    return json({
      error: "Unexpected error"
    }, 500);
  }
});

if (import.meta.main) Deno.serve(handler);
