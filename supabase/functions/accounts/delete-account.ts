import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../_shared/modules/logger/mod.ts";
import { authorizeAccountOrganization } from "./authorization.ts";

type DeleteAccountResponse = {
  status: number;
  body: Record<string, unknown>;
};

export async function deleteAccount(params: {
  service: SupabaseClient;
  logger: EdgeLogger;
  userId: string;
  requestedOrgId?: string;
}): Promise<DeleteAccountResponse> {
  const { service, logger, userId, requestedOrgId } = params;
  const authorization = await authorizeAccountOrganization(
    service,
    userId,
    requestedOrgId,
  );
  if (!authorization.ok) {
    return {
      status: authorization.status,
      body: { error: authorization.error },
    };
  }

  const orgId = authorization.orgId;
  const { data: subscription, error: subscriptionError } = await service
    .from("subscriptions")
    .select("org_id, status, plan, mollie_customer_id, mollie_subscription_id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (subscriptionError) {
    return { status: 500, body: { error: "Load subscriptions failed" } };
  }

  const mollieAction = "skipped";

  const now = new Date().toISOString();
  const { error: organizationError } = await service
    .from("organizations")
    .update({
      status: "suspended",
      plan: "free",
      plan_started_at: now,
      plan_expires_at: null,
      updated_at: now,
    })
    .eq("id", orgId);
  if (organizationError) {
    return { status: 500, body: { error: "DB_ORG_UPDATE_FAILED" } };
  }

  const { error: deleteSubscriptionError } = await service
    .from("subscriptions")
    .delete()
    .eq("org_id", orgId);
  if (deleteSubscriptionError) {
    return { status: 500, body: { error: "DB_SUB_DELETE_FAILED" } };
  }

  const { error: deleteUserError } =
    await service.auth.admin.deleteUser(userId);
  if (deleteUserError) {
    logger.error("auth_user_deletion_failed", {
      orgId,
      userId,
      message: deleteUserError.message,
      name: deleteUserError.name ?? null,
      status: deleteUserError.status ?? null,
    });
    return {
      status: 500,
      body: {
        ok: false,
        error: "AUTH_DELETE_FAILED",
        details: deleteUserError.message ?? null,
      },
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      orgId,
      userId,
      mollieAction,
      previous: subscription
        ? {
            status: subscription.status ?? null,
            plan: subscription.plan ?? null,
          }
        : null,
    },
  };
}
