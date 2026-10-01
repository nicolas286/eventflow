import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { envTrim } from "../_shared/config.ts";
import {
  badRequest,
  forbidden,
  internal,
  ResponseError,
} from "../_shared/errors.ts";
import { assertStripeApiKey } from "../_shared/environment-safety.ts";
import { serializeError } from "../_shared/modules/logger/mod.ts";
import {
  isStripeAccountReady,
  persistStripeAccountStatus,
} from "../_shared/payments/stripe-connect-db.ts";
import { StripeConnectedAccountProvider } from "../_shared/payments/stripe-connect-provider.ts";
import {
  assertStripeConnectAllowedForUser,
  isStripeConnectAllowedForOrganization,
} from "../_shared/payments/stripe-access.ts";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(
        value,
      )
  );
}

export const handleStripeConnectStatus = createEdgeHandler(
  {
    name: "stripe-connect-status",
    method: "POST",
    auth: "required",
    serviceClient: true,
    onError: ({ req, logger, error }) => {
      if (error instanceof ResponseError) {
        return json(req, { error: error.code }, error.status);
      }
      logger.error("unexpected_error", { error: serializeError(error) });
      return json(req, { error: "UNEXPECTED" }, 500);
    },
  },
  async ({ req, user, serviceClient: admin }) => {
    const body = await req.json().catch(() => null);
    const orgId = body && typeof body === "object" && "orgId" in body
      ? (body as { orgId?: unknown }).orgId
      : null;
    if (!isUuid(orgId)) throw badRequest("INVALID_ORG_ID");

    const stripeSecretKey = envTrim("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw internal("STRIPE_SECRET_KEY_MISSING");
    assertStripeApiKey(stripeSecretKey);

    const { data: member, error: memberError } = await admin
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", user.id)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (memberError) throw internal("AUTH_CHECK_FAILED");
    if (!member) throw forbidden();

    await assertStripeConnectAllowedForUser(admin, user.id);

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("created_by, stripe_connected_account_id")
      .eq("id", orgId)
      .maybeSingle();
    if (orgError || !org?.stripe_connected_account_id) {
      throw badRequest("STRIPE_ACCOUNT_NOT_CONFIGURED");
    }
    if (!(await isStripeConnectAllowedForOrganization(admin, org.created_by))) {
      throw forbidden("STRIPE_CONNECT_NOT_ALLOWED");
    }

    const provider = new StripeConnectedAccountProvider(stripeSecretKey);
    const status = await provider.getConnectedAccountStatus(
      org.stripe_connected_account_id,
    );
    await persistStripeAccountStatus(admin, orgId, status, {
      selectProvider: true,
      expectedAccountId: org.stripe_connected_account_id,
    });

    return json(req, {
      ok: true,
      status: !status.configurationSupported
        ? "requires_migration"
        : isStripeAccountReady(status)
        ? "connected"
        : "pending",
      accountType: status.accountType,
      configurationSupported: status.configurationSupported,
      complianceVerified: status.configurationSupported,
      requirementsDisabledReason: status.requirementsDisabledReason,
      requirementsCurrentlyDue: status.requirementsCurrentlyDue,
      detailsSubmitted: status.detailsSubmitted,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
    });
  },
);

if (import.meta.main) Deno.serve(handleStripeConnectStatus);
