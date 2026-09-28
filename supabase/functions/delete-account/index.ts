import { createClient } from "npm:@supabase/supabase-js@2.91.1";
import { resolveSupabaseRuntimeConfig } from "../_shared/config.ts";
import { createEdgeHandler } from "../_shared/edge-handler.ts";
import {
  badRequest,
  forbidden,
  internal,
  notFound,
  unauthorized,
} from "../_shared/errors.ts";
import { json } from "../_shared/http.ts";
type SubscriptionRow = {
  status: string | null;
  plan: string | null;
};

function bearer(req: Request) {
  return (
    req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

Deno.serve(
  createEdgeHandler("delete-account", async (req, { logger }) => {
    const token = bearer(req);
    if (!token) throw unauthorized();

    const body = await req.json().catch(() => ({}));
    if (typeof body !== "object" || body === null) {
      throw badRequest("INVALID_PAYLOAD");
    }
    const requestedOrgId = "orgId" in body ? body.orgId : null;
    if (requestedOrgId != null && !isUuid(requestedOrgId)) {
      throw badRequest("INVALID_ORG_ID");
    }

    const config = resolveSupabaseRuntimeConfig();
    const userClient = createClient(config.supabaseUrl, config.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const admin = createClient(config.supabaseUrl, config.serviceKey);
    const { data: userData, error: userError } =
      await userClient.auth.getUser();
    if (userError || !userData.user) throw unauthorized("INVALID_SESSION");
    const userId = userData.user.id;

    let membershipQuery = admin
      .from("organization_members")
      .select("org_id, role")
      .eq("user_id", userId)
      .in("role", ["owner", "admin"]);
    if (requestedOrgId) {
      membershipQuery = membershipQuery.eq("org_id", requestedOrgId);
    }
    const { data: membership, error: membershipError } = await membershipQuery
      .limit(1)
      .maybeSingle();
    if (membershipError) throw internal("MEMBERSHIP_LOAD_FAILED");
    if (!membership) {
      if (requestedOrgId) throw forbidden();
      throw notFound("NO_ORG_FOUND");
    }
    const orgId = membership.org_id;

    const { data, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("status, plan")
      .eq("org_id", orgId)
      .maybeSingle();
    if (subscriptionError) throw internal("SUBSCRIPTION_LOAD_FAILED");
    const subscription = data as SubscriptionRow | null;

    const now = new Date().toISOString();
    const { error: organizationError } = await admin
      .from("organizations")
      .update({
        status: "suspended",
        plan: "free",
        plan_started_at: now,
        plan_expires_at: null,
        updated_at: now,
      })
      .eq("id", orgId);
    if (organizationError) throw internal("DB_ORG_UPDATE_FAILED");

    const { error: deleteSubscriptionError } = await admin
      .from("subscriptions")
      .delete()
      .eq("org_id", orgId);
    if (deleteSubscriptionError) throw internal("DB_SUB_DELETE_FAILED");

    const { error: deleteUserError } =
      await admin.auth.admin.deleteUser(userId);
    if (deleteUserError) {
      logger.error("auth_delete_failed", {
        orgId,
        userId,
        message: deleteUserError.message,
      });
      throw internal("AUTH_DELETE_FAILED");
    }

    return json({
      ok: true,
      orgId,
      userId,
      previous: subscription
        ? { status: subscription.status, plan: subscription.plan }
        : null,
    });
  }),
);
