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

Deno.serve(
  createEdgeHandler("stripe-connect-status", async (req) => {
    const token = bearer(req);
    if (!token) throw unauthorized();

    const body = await req.json().catch(() => null);
    const orgId =
      body && typeof body === "object" && "orgId" in body
        ? String((body as { orgId?: unknown }).orgId ?? "")
        : "";
    if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw badRequest("INVALID_ORG_ID");

    const config = resolveSupabaseRuntimeConfig();
    const stripeSecretKey = envTrim("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw internal("STRIPE_SECRET_KEY_MISSING");
    assertStripeApiKey(stripeSecretKey);

    const userClient = createClient(config.supabaseUrl, config.anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const admin = createClient(config.supabaseUrl, config.serviceKey);
    const { data: userData, error: userError } =
      await userClient.auth.getUser();
    if (userError || !userData.user) throw unauthorized("INVALID_SESSION");

    const { data: member } = await admin
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userData.user.id)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (!member) throw forbidden();

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("stripe_connected_account_id")
      .eq("id", orgId)
      .maybeSingle();
    if (orgError || !org?.stripe_connected_account_id) {
      throw badRequest("STRIPE_ACCOUNT_NOT_CONFIGURED");
    }

    const provider = new StripeConnectedAccountProvider(stripeSecretKey);
    const status = await provider.getConnectedAccountStatus(
      org.stripe_connected_account_id,
    );
    await persistStripeAccountStatus(admin, orgId, status, {
      selectProvider: true,
    });

    return json({
      ok: true,
      status: isStripeAccountReady(status) ? "connected" : "pending",
      detailsSubmitted: status.detailsSubmitted,
      chargesEnabled: status.chargesEnabled,
      payoutsEnabled: status.payoutsEnabled,
    });
  }),
);
