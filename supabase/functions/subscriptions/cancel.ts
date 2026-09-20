import { cancelSubscriptionPayloadSchema } from "../../../shared/schemas/subscriptions-cancel.ts";
import { mollieFetch } from "./mollie.ts";
import { assertMollieApiKey } from "../_shared/environment-safety.ts";
import { createClient } from "@supabase/supabase-js";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}
function envTrim(name: string) {
  const v = Deno.env.get(name);
  const t = typeof v === "string" ? v.trim() : "";
  return t ? t : null;
}
async function getExistingSubscription(params: CancelParams) {
  const { mollieKey, customerId, subscriptionId } = params;
  const { res, data, rawText } = await mollieFetch(
    `https://api.mollie.com/v2/customers/${customerId}/subscriptions/${subscriptionId}`,
    mollieKey,
    {
      method: "GET",
    },
  );
  if (res.status === 404) {
    return {
      ok: false as const,
      error: "MOLLIE_SUB_404_WRONG_MAPPING",
      details: rawText,
    };
  }
  if (!res.ok) {
    return {
      ok: false as const,
      error: "MOLLIE_SUB_FETCH_FAILED",
      details: rawText,
    };
  }
  const id = typeof data?.id === "string" ? data.id : null;
  if (!id || id !== subscriptionId) {
    return {
      ok: false as const,
      error: "MOLLIE_SUB_ID_MISMATCH",
    };
  }
  return {
    ok: true as const,
    subscription: data,
  };
}
async function cancelSubscriptionStrict(params: CancelParams) {
  const { mollieKey, customerId, subscriptionId } = params;
  const got = await getExistingSubscription({
    mollieKey,
    customerId,
    subscriptionId,
  });
  if (got.ok === false) {
    // ✅ narrowing béton
    return {
      ok: false as const,
      error: got.error,
      details: got.details,
    };
  }
  const status = String(got.subscription?.status ?? "").toLowerCase();
  if (
    status === "canceled" || status === "cancelled" || status === "completed" ||
    status === "terminated"
  ) {
    return {
      ok: true as const,
      alreadyCanceled: true,
    };
  }
  const { res, rawText } = await mollieFetch(
    `https://api.mollie.com/v2/customers/${customerId}/subscriptions/${subscriptionId}`,
    mollieKey,
    {
      method: "DELETE",
    },
  );
  if (res.status === 404) {
    return {
      ok: false as const,
      error: "MOLLIE_CANCEL_404_AFTER_GET",
      details: rawText,
    };
  }
  if (!res.ok) {
    return {
      ok: false as const,
      error: "MOLLIE_CANCEL_SUB_FAILED",
      details: rawText,
    };
  }
  return {
    ok: true as const,
    alreadyCanceled: false,
  };
}
export async function cancelSubscription(
  req: Request,
  orgId: string,
): Promise<Response> {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders,
      });
    }
    if (req.method !== "DELETE") {
      return json({
        error: "Method not allowed",
      }, 405);
    }
    const token = getBearer(req);
    if (!token) {
      return json({
        error: "Missing Authorization bearer token",
      }, 401);
    }
    if (!cancelSubscriptionPayloadSchema.safeParse({ orgId }).success) {
      return json({
        error: "Invalid payload",
      }, 400);
    }
    const supabaseUrl = envTrim("SUPABASE_URL");
    const serviceKey = envTrim("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = envTrim("SUPABASE_ANON_KEY");
    const mollieKey = envTrim("MOLLIE_API_KEY");
    assertMollieApiKey(mollieKey); // ✅ clé plateforme
    if (!supabaseUrl || !serviceKey || !anonKey || !mollieKey) {
      return json({
        error: "Server misconfigured",
      }, 500);
    }
    // 1) Validate JWT
    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });
    const service = createClient(supabaseUrl, serviceKey); // no jwt
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({
        error: "Invalid session",
      }, 401);
    }
    const userId = userData.user.id;
    // 2) AuthZ owner/admin on org
    const { data: om, error: omErr } = await service.from(
      "organization_members",
    ).select("role").eq("org_id", orgId).eq("user_id", userId).in("role", [
      "owner",
      "admin",
    ]).limit(1);
    if (omErr) {
      return json({
        error: "Auth check failed",
      }, 500);
    }
    if (!om || om.length === 0) {
      return json({
        error: "Forbidden",
      }, 403);
    }
    // 3) Load current subscription (DB mapping)
    const { data: subRow, error: subErr } = await service.from("subscriptions")
      .select(
        "org_id, status, plan, mollie_customer_id, mollie_subscription_id",
      ).eq("org_id", orgId).maybeSingle();
    if (subErr) {
      return json({
        error: "Load subscriptions failed",
      }, 500);
    }
    const mollieCustomerId = subRow?.mollie_customer_id ?? null;
    const mollieSubscriptionId = subRow?.mollie_subscription_id ?? null;
    // 4) Cancel on Mollie (strict)
    let mollieAction = "skipped";
    if (mollieCustomerId && mollieSubscriptionId) {
      const cancel = await cancelSubscriptionStrict({
        mollieKey,
        customerId: mollieCustomerId,
        subscriptionId: mollieSubscriptionId,
      });
      if (!cancel.ok) {
        console.error("[cancel-subscription] mollie cancel failed", {
          orgId,
          error: cancel.error,
          details: cancel.details,
        });
        return json({
          error: cancel.error,
        }, 502);
      }
      // ✅ ici TS sait que c'est MollieCancelOk
      mollieAction = cancel.alreadyCanceled ? "already_canceled" : "canceled";
    }
    // 5) DB -> free + delete subscription row
    const nowIso = new Date().toISOString();
    const { error: orgUpErr } = await service.from("organizations").update({
      plan: "free",
      plan_started_at: nowIso,
      plan_expires_at: null,
      updated_at: nowIso,
    }).eq("id", orgId);
    if (orgUpErr) {
      return json({
        error: "DB_ORG_UPDATE_FAILED",
      }, 500);
    }
    const { error: delErr } = await service.from("subscriptions").delete().eq(
      "org_id",
      orgId,
    );
    if (delErr) {
      return json({
        error: "DB_SUB_DELETE_FAILED",
      }, 500);
    }
    return json({
      ok: true as const,
      action: "canceled",
      orgId,
      mollieAction,
      previous: subRow
        ? {
          status: subRow.status ?? null,
          plan: subRow.plan ?? null,
        }
        : null,
    });
  } catch (e) {
    console.error("[cancel-subscription] unexpected", e);
    return json({
      error: "Unexpected error",
    }, 500);
  }
}

type CancelParams = {
  mollieKey: string;
  customerId: string;
  subscriptionId: string;
};
