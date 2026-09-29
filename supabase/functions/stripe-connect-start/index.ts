import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { envTrim } from "../_shared/config.ts";
import {
  badRequest,
  conflict,
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
import { getAcceptedOrganizationSalesTerms } from "../_shared/payments/organization-sales-terms.ts";
import {
  parseAllowedOrigins,
  resolveAppBaseUrlFromRequest,
} from "../_shared/url.ts";

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export const handleStripeConnectStart = createEdgeHandler(
  {
    name: "stripe-connect-start",
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
    const orgId =
      body && typeof body === "object" && "orgId" in body
        ? (body as { orgId?: unknown }).orgId
        : null;
    if (!isUuid(orgId)) throw badRequest("INVALID_ORG_ID");

    const stripeSecretKey = envTrim("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw internal("STRIPE_SECRET_KEY_MISSING");
    assertStripeApiKey(stripeSecretKey);

    const allowedOrigins = parseAllowedOrigins(envTrim("APP_ALLOWED_ORIGINS"));
    const appBaseUrl = resolveAppBaseUrlFromRequest(req, allowedOrigins);
    if (!appBaseUrl) throw forbidden("ORIGIN_NOT_ALLOWED");

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
      .select("id, name, created_by, stripe_connected_account_id")
      .eq("id", orgId)
      .maybeSingle();
    if (orgError || !org) throw badRequest("ORGANIZATION_NOT_FOUND");
    if (!(await isStripeConnectAllowedForOrganization(admin, org.created_by))) {
      throw forbidden("STRIPE_CONNECT_NOT_ALLOWED");
    }
    await getAcceptedOrganizationSalesTerms(admin, orgId);

    const provider = new StripeConnectedAccountProvider(stripeSecretKey);
    let status = org.stripe_connected_account_id
      ? await provider.getConnectedAccountStatus(
          org.stripe_connected_account_id,
        )
      : await provider.createConnectedAccount({
          orgId,
          email: user.email ?? null,
          displayName: org.name,
        });

    if (org.stripe_connected_account_id && !status.configurationSupported) {
      const replacement = await provider.createConnectedAccount({
        orgId,
        email: user.email ?? null,
        displayName: org.name,
      });
      const { error: migrationError } = await admin.rpc(
        "replace_stripe_account_for_standard_migration",
        {
          p_org_id: orgId,
          p_expected_old_account_id: org.stripe_connected_account_id,
          p_new_account_id: replacement.providerAccountId,
        },
      );
      if (migrationError) {
        throw internal("STRIPE_ACCOUNT_MIGRATION_SAVE_FAILED");
      }
      status = replacement;
    }

    await persistStripeAccountStatus(admin, orgId, status, {
      selectProvider: isStripeAccountReady(status),
    });

    if (!status.configurationSupported) {
      throw conflict("STRIPE_ACCOUNT_REQUIRES_STANDARD_MIGRATION");
    }

    const url = await provider.createAccountOnboardingLink({
      providerAccountId: status.providerAccountId,
      returnUrl: `${appBaseUrl}/admin/structure?stripe_connect=return`,
      refreshUrl: `${appBaseUrl}/admin/structure?stripe_connect=refresh`,
    });

    return json(req, { ok: true, url });
  },
);

if (import.meta.main) Deno.serve(handleStripeConnectStart);
