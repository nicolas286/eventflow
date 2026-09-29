import { createClient } from "@supabase/supabase-js";
import { cancelSubscriptionPayloadSchema } from "../../../shared/schemas/subscriptions-cancel.ts";
import { corsHeaders, getBearer, json } from "./http.ts";

function envTrim(name: string) {
  const value = Deno.env.get(name)?.trim();
  return value || null;
}

export async function cancelSubscription(
  req: Request,
  orgId: string,
): Promise<Response> {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: corsHeaders(req.headers.get("origin")),
      });
    }
    if (req.method !== "DELETE") {
      return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const token = getBearer(req);
    if (!token) return json(req, { error: "NOT_AUTHENTICATED" }, 401);
    if (!cancelSubscriptionPayloadSchema.safeParse({ orgId }).success) {
      return json(req, { error: "VALIDATION_ERROR" }, 400);
    }

    const supabaseUrl = envTrim("SUPABASE_URL");
    const serviceKey = envTrim("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = envTrim("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json(req, { error: "SERVER_MISCONFIGURED" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const service = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userError } =
      await userClient.auth.getUser();
    if (userError || !userData.user) {
      return json(req, { error: "INVALID_SESSION" }, 401);
    }

    const { data: membership, error: membershipError } = await service
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (membershipError) return json(req, { error: "AUTH_CHECK_FAILED" }, 500);
    if (!membership) return json(req, { error: "FORBIDDEN" }, 403);

    const { data: subscription, error: subscriptionError } = await service
      .from("subscriptions")
      .select("org_id, status, plan")
      .eq("org_id", orgId)
      .maybeSingle();
    if (subscriptionError) {
      return json(req, { error: "LOAD_SUBSCRIPTION_FAILED" }, 500);
    }

    const { error: cancelError } = await service.rpc(
      "cancel_internal_subscription",
      { p_org_id: orgId },
    );
    if (cancelError) return json(req, { error: "DB_CANCEL_FAILED" }, 500);

    return json(req, {
      ok: true,
      action: "canceled",
      orgId,
      mollieAction: "skipped",
      previous: subscription
        ? {
            status: subscription.status ?? null,
            plan: subscription.plan ?? null,
          }
        : null,
    });
  } catch (error) {
    console.error("[cancel-subscription] unexpected", error);
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  }
}
