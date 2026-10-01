import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { resolveEventPaymentProvider } from "../orders/public/payment-provider.ts";

Deno.test("a ready connected seller can sell while reacceptance and legal identity are pending", async () => {
  const calls: string[] = [];
  const previousEnv = Deno.env.get("APP_ENV");
  const previousUrl = Deno.env.get("SUPABASE_URL");
  Deno.env.set("APP_ENV", "staging");
  Deno.env.set("SUPABASE_URL", "https://fixture.supabase.co");
  try {
    const admin = createClient("https://fixture.supabase.co", "fixture-service", {
      global: { fetch: (request) => {
        const url = new URL(request instanceof Request ? request.url : String(request));
        calls.push(url.pathname);
        if (url.pathname.endsWith("/organizations")) return Promise.resolve(Response.json({
          created_by: "11111111-1111-4111-8111-111111111111",
          payments_provider: "stripe", stripe_connected_account_id: "acct_fixture",
          stripe_compliance_verified: true, stripe_details_submitted: true,
          stripe_charges_enabled: true, stripe_payouts_enabled: true,
          stripe_requirements_disabled_reason: null, stripe_requirements_currently_due: [],
        }));
        if (url.pathname.endsWith("/user_profile")) return Promise.resolve(Response.json({ stripe_connect_allowed: true }));
        throw new Error(`Unexpected prerequisite ${url.pathname}`);
      } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await resolveEventPaymentProvider({
      admin, orgId: "22222222-2222-4222-8222-222222222222",
      stripeSecretKey: "sk_test_fixture", stripePaymentMethodConfigurationId: "pmc_fixture", providerSelection: "stripe",
    });
    assertEquals(result.kind, "stripe");
    assertEquals(calls, ["/rest/v1/organizations", "/rest/v1/user_profile"]);
  } finally {
    if (previousEnv === undefined) Deno.env.delete("APP_ENV"); else Deno.env.set("APP_ENV", previousEnv);
    if (previousUrl === undefined) Deno.env.delete("SUPABASE_URL"); else Deno.env.set("SUPABASE_URL", previousUrl);
  }
});
