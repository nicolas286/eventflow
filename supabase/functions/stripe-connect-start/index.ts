import { createClient } from "npm:@supabase/supabase-js@2.91.1";
import { createEdgeHandler } from "../_shared/edge-handler.ts";
import { envTrim, resolveSupabaseRuntimeConfig } from "../_shared/config.ts";
import {
  badRequest,
  forbidden,
  internal,
  unauthorized,
} from "../_shared/errors.ts";
import { json } from "../_shared/http.ts";
import { assertStripeApiKey } from "../_shared/environment-safety.ts";
import {
  parseAllowedOrigins,
  resolveAppBaseUrlFromRequest,
} from "../_shared/url.ts";
import { StripeConnectedAccountProvider } from "../_shared/payments/stripe-connect-provider.ts";
import {
  isStripeAccountReady,
  persistStripeAccountStatus,
} from "../_shared/payments/stripe-connect-db.ts";

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
  createEdgeHandler("stripe-connect-start", async (req) => {
    const token = bearer(req);
    if (!token) throw unauthorized();

    const body = await req.json().catch(() => null);
    const orgId =
      body && typeof body === "object" && "orgId" in body
        ? (body as { orgId?: unknown }).orgId
        : null;
    if (!isUuid(orgId)) throw badRequest("INVALID_ORG_ID");

    const config = resolveSupabaseRuntimeConfig();
    const stripeSecretKey = envTrim("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw internal("STRIPE_SECRET_KEY_MISSING");
    assertStripeApiKey(stripeSecretKey);

    const allowedOrigins = parseAllowedOrigins(envTrim("APP_ALLOWED_ORIGINS"));
    const appBaseUrl = resolveAppBaseUrlFromRequest(req, allowedOrigins);
    if (!appBaseUrl) throw forbidden("ORIGIN_NOT_ALLOWED");

    const userClient = createClient(config.supabaseUrl, config.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const admin = createClient(config.supabaseUrl, config.serviceKey);

    const { data: userData, error: userError } =
      await userClient.auth.getUser();
    if (userError || !userData.user) throw unauthorized("INVALID_SESSION");

    const { data: member, error: memberError } = await admin
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (memberError) throw internal("AUTH_CHECK_FAILED");
    if (!member) throw forbidden();

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, name, stripe_connected_account_id")
      .eq("id", orgId)
      .maybeSingle();
    if (orgError || !org) throw badRequest("ORGANIZATION_NOT_FOUND");

    const provider = new StripeConnectedAccountProvider(stripeSecretKey);
    const status = org.stripe_connected_account_id
      ? await provider.getConnectedAccountStatus(
          org.stripe_connected_account_id,
        )
      : await provider.createConnectedAccount({
          orgId,
          email: userData.user.email ?? null,
          displayName: org.name,
        });

    await persistStripeAccountStatus(admin, orgId, status, {
      selectProvider: isStripeAccountReady(status),
    });

    const returnUrl = `${appBaseUrl}/admin/structure?stripe_connect=return`;
    const refreshUrl = `${appBaseUrl}/admin/structure?stripe_connect=refresh`;
    const url = await provider.createAccountOnboardingLink({
      providerAccountId: status.providerAccountId,
      returnUrl,
      refreshUrl,
    });

    return json({ ok: true, url });
  }),
);
