import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import {
  accountRateLimits,
  applicationRateLimits,
  platformAdminRateLimits,
  registerTicketsRateLimits,
} from "../_shared/app/config/rate-limits.ts";
import { handler as handleAccounts } from "../accounts/index.ts";
import { handlePlatformAdminRequest } from "../platform-admin/index.ts";
import { hashRateLimitKey } from "../_shared/modules/supabase-rate-limit/mod.ts";
import { handleStripeConnectStart } from "../stripe-connect-start/index.ts";
import { handleStripeConnectStatus } from "../stripe-connect-status/index.ts";
import { handleOrganizationPaymentSettingsRequest } from "../organization-payment-settings/index.ts";
import { handler as handleSubscriptions } from "../subscriptions/index.ts";
import { handleGetInvoicePdfUrlRequest } from "../invoices/index.ts";
import { handleOrdersRequest } from "../orders/index.ts";
import { handlePlatformConfigRequest } from "../platform-config/index.ts";

const orgId = "11111111-1111-4111-8111-111111111111";
const userA = "22222222-2222-4222-8222-222222222222";
const userB = "33333333-3333-4333-8333-333333333333";
const orderId = "44444444-4444-4444-8444-444444444444";
const eventId = "55555555-5555-4555-8555-555555555555";
const invoiceId = "66666666-6666-4666-8666-666666666666";
const origin = "https://app.fixture.test";
const salt = "application-rate-limit-synthetic-salt";
const bookingToken = "synthetic-booking-capability";

const quotaSchema = z.object({
  p_key_hash: z.string().regex(/^[a-f0-9]{64}$/),
  p_scope: z.string(),
  p_limit: z.number().int().positive(),
  p_window_seconds: z.number().int().positive(),
});
type Quota = z.infer<typeof quotaSchema>;
type Policy = { scope: string; limit: number; windowSeconds: number };
type FixtureOptions = {
  member?: boolean;
  invalidSession?: boolean;
  quota?: "allowed" | "denied" | "unavailable" | "budget";
  businessError?: boolean;
  trustCloudflare?: boolean;
  quotaResponse?: unknown;
  unavailableMessage?: string;
  denyScope?: string;
  missingOrder?: boolean;
  orderErrorMessage?: string;
};
type Runtime = {
  calls: Request[];
  quotas: Quota[];
  counts: Map<string, number>;
  advance: (seconds: number) => void;
};

async function fixture(
  run: (runtime: Runtime) => Promise<void>,
  options: FixtureOptions = {},
) {
  const env = {
    SUPABASE_URL: "https://application-quota-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: salt,
    RATE_LIMIT_TRUST_CLOUDFLARE_IP: options.trustCloudflare ? "1" : "0",
    APP_ENV: "staging",
    APP_ALLOWED_ORIGINS: origin,
    STRIPE_SECRET_KEY: "sk_test_fixture",
    EARLY_ADOPTER_ACTIVE: "false",
    TURNSTILE_SECRET_KEY: "fixture-turnstile",
    TURNSTILE_BYPASS: "0",
  };
  const previousEnv = new Map(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const previousFetch = globalThis.fetch;
  const calls: Request[] = [];
  const quotas: Quota[] = [];
  const counts = new Map<string, number>();
  let time = 0;
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    calls.push(req);
    const url = new URL(req.url);
    const path = url.pathname;
    if (path === "/auth/v1/user") {
      if (options.invalidSession) {
        return Response.json({ message: "Invalid session" }, { status: 401 });
      }
      return Response.json({
        id: req.headers.get("authorization") === "Bearer fixture-user-b"
          ? userB
          : userA,
        email: "fixture@example.test",
        email_confirmed_at: "2026-10-01T00:00:00.000Z",
      });
    }
    if (path === "/rest/v1/rpc/consume_rate_limit") {
      const args: unknown = await req.json();
      const quota = quotaSchema.parse(args);
      quotas.push(quota);
      if ("quotaResponse" in options) {
        return Response.json(options.quotaResponse);
      }
      if (options.quota === "unavailable") {
        return Response.json({
          message: options.unavailableMessage ?? "fixture database unavailable",
        }, {
          status: 503,
        });
      }
      const key = `${quota.p_scope}:${quota.p_key_hash}:${
        Math.floor(time / quota.p_window_seconds)
      }`;
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      const allowed =
        options.quota === "denied" || options.denyScope === quota.p_scope
          ? false
          : options.quota === "budget"
          ? count <= quota.p_limit
          : true;
      return Response.json([{
        allowed,
        request_count: count,
        retry_after_seconds: allowed ? 0 : 37,
      }]);
    }
    if (path === "/rest/v1/organization_members") {
      assertEquals(url.searchParams.get("org_id"), `eq.${orgId}`);
      assert(
        [userA, userB].some((id) =>
          url.searchParams.get("user_id") === `eq.${id}`
        ),
      );
      return Response.json(options.member === false ? null : { role: "admin" });
    }
    if (path === "/rest/v1/rpc/is_org_member") {
      return Response.json(options.member !== false);
    }
    if (path === "/rest/v1/user_profile") {
      return Response.json({ stripe_connect_allowed: true });
    }
    if (
      url.hostname === "challenges.cloudflare.com" &&
      path === "/turnstile/v0/siteverify"
    ) {
      return Response.json({ success: true });
    }
    if (path === "/rest/v1/rpc/platform_admin_access_state") {
      return Response.json({ sessionActive: true, isPlatformAdmin: false });
    }
    if (path === "/rest/v1/organizations") {
      return Response.json({
        id: orgId,
        name: "Fixture",
        status: "active",
        created_by: userA,
        payments_provider: "stripe",
        stripe_connected_account_id: "acct_fixture",
        bank_transfer_beneficiary: null,
        bank_transfer_iban: null,
        slug: "fixture",
      });
    }
    if (url.hostname === "api.stripe.com") {
      if (options.businessError) {
        return Response.json({ error: { code: "api_error" } }, { status: 400 });
      }
      if (path === "/v1/accounts/acct_fixture") {
        return Response.json({
          id: "acct_fixture",
          type: "standard",
          details_submitted: true,
          charges_enabled: true,
          payouts_enabled: true,
          requirements: { currently_due: [] },
        });
      }
      if (path === "/v1/account_links") {
        return Response.json({ url: "https://connect.stripe.com/fixture" });
      }
    }
    if (path === "/rest/v1/rpc/platform_public_config") {
      return Response.json({
        registrationsOpen: true,
        registrationPublicMessage: "Fixture",
        announcement: null,
      });
    }
    if (
      path === "/rest/v1/rpc/organizer_update_organization_payment_settings" ||
      path === "/rest/v1/rpc/organizer_accept_organization_sales_terms"
    ) {
      return Response.json({
        orgId,
        paymentsProvider: "stripe",
        bankTransferBeneficiary: null,
        bankTransferIban: null,
        bankTransferIbanMasked: null,
        bankTransferIbanChanged: false,
        salesTermsCurrent: true,
      });
    }
    if (path === "/rest/v1/rpc/create_manual_subscription_invoice") {
      if (options.businessError) {
        return Response.json({ message: "billing profile missing" }, {
          status: 400,
        });
      }
      return Response.json({
        ok: true,
        org_id: orgId,
        plan: "starter",
        provider: "manual",
        status: "active",
        invoice_id: invoiceId,
        invoice_number: "2026-000001",
        due_at: "2026-10-12T00:00:00.000Z",
        current_period_end: "2026-10-28T00:00:00.000Z",
        reused: true,
      });
    }
    if (path === "/rest/v1/subscriptions") {
      return Response.json({
        org_id: orgId,
        status: "active",
        plan: "starter",
      });
    }
    if (path === "/rest/v1/rpc/cancel_internal_subscription") {
      return Response.json({ ok: true });
    }
    if (path === "/rest/v1/invoices") {
      return Response.json({
        id: invoiceId,
        org_id: orgId,
        pdf_path: "fixture.pdf",
      });
    }
    if (path === "/storage/v1/object/sign/invoices/fixture.pdf") {
      return Response.json({
        signedURL: "/object/sign/invoices/fixture.pdf?fixture=1",
      });
    }
    if (path === "/rest/v1/events") {
      return Response.json({
        id: eventId,
        org_id: orgId,
        slug: "fixture-event",
      });
    }
    if (path === "/rest/v1/event_products") {
      return Response.json([{ id: eventId, event_id: eventId }]);
    }
    if (path === "/rest/v1/rpc/create_order_intent") {
      return Response.json({
        order_id: orderId,
        total_cents: 0,
        amount_due_now_cents: 0,
        currency: "EUR",
        payment_required: false,
        status: "paid",
      });
    }
    if (path === "/rest/v1/orders") {
      if (options.missingOrder) return Response.json(null);
      if (options.orderErrorMessage) {
        return Response.json({ message: options.orderErrorMessage }, {
          status: 400,
        });
      }
      const token = url.searchParams.get("booking_token");
      if (token !== null && token !== `eq.${bookingToken}`) {
        return Response.json(null);
      }
      return Response.json({
        id: orderId,
        org_id: orgId,
        event_id: eventId,
        status: "paid",
        total_cents: 0,
        paid_cents: 0,
        currency: "EUR",
        buyer_email: null,
      });
    }
    if (path === "/rest/v1/order_items") return Response.json([]);
    if (path === "/rest/v1/payments") {
      return Response.json({
        amount_cents: 0,
        currency: "EUR",
        status: "paid",
        raw: { method: "bank_transfer" },
      });
    }
    if (path === "/rest/v1/rpc/apply_order_payment") {
      return Response.json({
        status: "paid",
        paid_cents: 0,
        total_cents: 0,
        idempotent: true,
      });
    }
    if (path === "/rest/v1/rpc/claim_order_confirmation_email") {
      return Response.json({ ok: false });
    }
    if (
      path === "/rest/v1/rpc/mark_bank_transfer_manually_confirmed" ||
      path === "/rest/v1/rpc/issue_order_tickets"
    ) return Response.json(null);
    throw new Error(`Unexpected fixture request: ${req.method} ${path}`);
  };
  try {
    await run({
      calls,
      quotas,
      counts,
      advance: (seconds) => {
        time += seconds;
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

function request(path: string, body?: unknown, method = "POST", user = "a") {
  return new Request(`https://edge.fixture.test/${path}`, {
    method,
    headers: {
      authorization: `Bearer fixture-user-${user}`,
      origin,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type Route = {
  name: string;
  policy: Policy;
  invoke: () => Promise<Response>;
};
const routes: Route[] = [
  {
    name: "Connect start",
    policy: applicationRateLimits.connectStart,
    invoke: () =>
      handleStripeConnectStart(request("stripe-connect-start", { orgId })),
  },
  {
    name: "Connect status",
    policy: applicationRateLimits.connectStatus,
    invoke: () =>
      handleStripeConnectStatus(request("stripe-connect-status", { orgId })),
  },
  {
    name: "payment settings read",
    policy: applicationRateLimits.paymentSettingsRead,
    invoke: () =>
      handleOrganizationPaymentSettingsRequest(
        request("organization-payment-settings", { orgId, action: "read" }),
      ),
  },
  {
    name: "payment settings update",
    policy: applicationRateLimits.paymentSettingsUpdate,
    invoke: () =>
      handleOrganizationPaymentSettingsRequest(
        request("organization-payment-settings", {
          orgId,
          action: "update",
          paymentsProvider: "stripe",
          bankTransferBeneficiary: null,
          bankTransferIban: null,
        }),
      ),
  },
  {
    name: "payment settings accept_terms",
    policy: applicationRateLimits.paymentSettingsAcceptTerms,
    invoke: () =>
      handleOrganizationPaymentSettingsRequest(
        request("organization-payment-settings", {
          orgId,
          action: "accept_terms",
          salesTerms: "# Fixture\n\n" + "Conditions synthétiques. ".repeat(12),
          confirmed: true,
        }),
      ),
  },
  {
    name: "subscription start",
    policy: applicationRateLimits.subscriptionStart,
    invoke: () =>
      handleSubscriptions(request("subscriptions", { orgId, plan: "starter" })),
  },
  {
    name: "subscription cancel",
    policy: applicationRateLimits.subscriptionCancel,
    invoke: () =>
      handleSubscriptions(
        request(`subscriptions/${orgId}`, undefined, "DELETE"),
      ),
  },
  {
    name: "invoice PDF",
    policy: applicationRateLimits.invoicePdf,
    invoke: () =>
      handleGetInvoicePdfUrlRequest(
        request(`invoices/${invoiceId}/pdf`, undefined, "GET"),
      ),
  },
  {
    name: "admin order creation",
    policy: applicationRateLimits.adminOrderCreate,
    invoke: () =>
      handleOrdersRequest(request("orders/admin", {
        eventId,
        buyer: { email: "fixture@example.test" },
        items: [{ eventProductId: eventId, quantity: 1 }],
        attendees: [{ eventProductId: eventId }],
      })),
  },
  {
    name: "admin order mark-paid",
    policy: applicationRateLimits.adminOrderMarkPaid,
    invoke: () =>
      handleOrdersRequest(request(`orders/admin/${orderId}/mark-paid`)),
  },
];

function assertPolicy(quota: Quota | undefined, policy: Policy) {
  assert(quota);
  assertEquals(quota.p_scope, policy.scope);
  assertEquals(quota.p_limit, policy.limit);
  assertEquals(quota.p_window_seconds, policy.windowSeconds);
}

function effects(calls: Request[]) {
  return calls.filter((call) => {
    const url = new URL(call.url);
    return url.hostname === "api.stripe.com" ||
      url.pathname.startsWith("/storage/") ||
      (call.method !== "GET" &&
        url.pathname !== "/rest/v1/rpc/consume_rate_limit" &&
        url.pathname !== "/rest/v1/rpc/is_org_member" &&
        url.pathname !== "/rest/v1/rpc/platform_public_config");
  });
}

for (const route of routes) {
  Deno.test(`A8 ${route.name}: under budget, one independent authorized quota before effects`, () =>
    fixture(async ({ calls, quotas }) => {
      const response = await route.invoke();
      assertEquals(response.status, 200);
      assertEquals(quotas.length, 1);
      assertPolicy(quotas[0], route.policy);
      assertEquals(
        quotas[0].p_key_hash,
        await hashRateLimitKey(`user:${userA}:org:${orgId}`, salt),
      );
      const quotaIndex = calls.findIndex((call) =>
        new URL(call.url).pathname.endsWith("/consume_rate_limit")
      );
      assert(quotaIndex > 0);
      assertEquals(new URL(calls[0].url).pathname, "/auth/v1/user");
      for (const effect of effects(calls)) {
        assert(calls.indexOf(effect) > quotaIndex);
      }
    }));

  for (const mode of ["denied", "unavailable"] as const) {
    Deno.test(`A8 ${route.name}: ${mode} stops all business/provider effects`, () =>
      fixture(async ({ calls, quotas }) => {
        const response = await route.invoke();
        assertEquals(response.status, mode === "denied" ? 429 : 503);
        assertEquals(await response.json(), {
          error: mode === "denied"
            ? "TOO_MANY_REQUESTS"
            : "RATE_LIMIT_UNAVAILABLE",
        });
        assertEquals(
          response.headers.get("retry-after"),
          mode === "denied" ? "37" : "30",
        );
        assertEquals(response.headers.get("cache-control"), "no-store");
        assertEquals(quotas.length, 1);
        assertEquals(effects(calls).length, 0);
      }, { quota: mode }));
  }

  Deno.test(`A8 ${route.name}: foreign organization cannot consume its quota`, () =>
    fixture(async ({ calls, quotas }) => {
      assertEquals((await route.invoke()).status, 403);
      assertEquals(quotas.length, 0);
      assertEquals(effects(calls).length, 0);
    }, { member: false }));

  Deno.test(`A8 ${route.name}: invalid identity cannot choose a user quota`, () =>
    fixture(async ({ calls, quotas }) => {
      assertEquals((await route.invoke()).status, 401);
      assertEquals(quotas.length, 0);
      assertEquals(calls.length, 1);
    }, { invalidSession: true }));
}

Deno.test("A8 authenticated key follows verified Auth identity, never payload userId", () =>
  fixture(async ({ quotas }) => {
    for (const user of ["a", "b"]) {
      assertEquals(
        (await handleStripeConnectStatus(request(
          "stripe-connect-status",
          {
            orgId,
            userId: userB,
          },
          "POST",
          user,
        ))).status,
        200,
      );
    }
    assertEquals(quotas.length, 2);
    assertEquals(
      quotas[0].p_key_hash,
      await hashRateLimitKey(`user:${userA}:org:${orgId}`, salt),
    );
    assertEquals(
      quotas[1].p_key_hash,
      await hashRateLimitKey(`user:${userB}:org:${orgId}`, salt),
    );
    assert(quotas[0].p_key_hash !== quotas[1].p_key_hash);
  }));

Deno.test("A8 Stripe polling stays usable for 30 repeated reads with one quota each", () =>
  fixture(async ({ quotas }) => {
    for (let index = 0; index < 30; index++) {
      assertEquals((await routes[1].invoke()).status, 200);
    }
    assertEquals(quotas.length, 30);
    assert(applicationRateLimits.connectStatus.limit >= 30);
  }, { quota: "budget" }));

Deno.test("A8 business failure leaves consumed quota; next request reaches 429 until window reopens", () =>
  fixture(async ({ counts, advance }) => {
    const limit = applicationRateLimits.subscriptionStart.limit;
    for (let index = 0; index < limit; index++) {
      const response = await routes[5].invoke();
      assertEquals(response.status, 400);
      assertEquals(await response.json(), {
        error: "BILLING_PROFILE_REQUIRED",
      });
    }
    assertEquals([...counts.values()], [limit]);
    assertEquals((await routes[5].invoke()).status, 429);
    advance(applicationRateLimits.subscriptionStart.windowSeconds);
    assertEquals((await routes[5].invoke()).status, 400);
    assertEquals(counts.size, 2);
  }, { quota: "budget", businessError: true }));

const publicRoutes = [
  {
    name: "orders/read",
    invoke: (headers: HeadersInit = {}) =>
      handleOrdersRequest(
        new Request(
          `https://edge.fixture.test/orders/${orderId}?token=${bookingToken}`,
          { headers },
        ),
      ),
    ip: applicationRateLimits.orderReadIp,
    fallback: applicationRateLimits.orderReadFallback,
  },
  {
    name: "platform-config",
    invoke: (headers: HeadersInit = {}) =>
      handlePlatformConfigRequest(
        new Request(
          "https://edge.fixture.test/platform-config",
          { headers },
        ),
      ),
    ip: applicationRateLimits.platformConfigIp,
    fallback: applicationRateLimits.platformConfigFallback,
  },
];

for (const route of publicRoutes) {
  Deno.test(`A8 ${route.name}: spoofed forwarding headers cannot create arbitrary IP counters`, () =>
    fixture(async ({ quotas }) => {
      for (const ip of ["198.51.100.10", "198.51.100.11"]) {
        assertEquals(
          (await route.invoke({
            "cf-connecting-ip": ip,
            "x-forwarded-for": ip,
            "x-real-ip": ip,
            "x-nf-client-connection-ip": ip,
          })).status,
          200,
        );
      }
      const ingress = quotas.filter((quota) =>
        quota.p_scope === route.fallback.scope
      );
      assertEquals(ingress.length, 2);
      assertPolicy(ingress[0], route.fallback);
      assertEquals(
        ingress[0].p_key_hash,
        await hashRateLimitKey("shared:unresolved", salt),
      );
      assertEquals(ingress[0].p_key_hash, ingress[1].p_key_hash);
    }));

  Deno.test(`A8 ${route.name}: explicit Cloudflare trust uses validated IP, absent IP uses bounded fallback`, () =>
    fixture(async ({ quotas }) => {
      assertEquals(
        (await route.invoke({ "cf-connecting-ip": "198.51.100.10" })).status,
        200,
      );
      assertPolicy(quotas[0], route.ip);
      assertEquals(
        quotas[0].p_key_hash,
        await hashRateLimitKey("ip:198.51.100.10", salt),
      );
      quotas.length = 0;
      const missingOrInvalidHeaders: HeadersInit[] = [{}, {
        "cf-connecting-ip": "invalid",
      }, { "x-forwarded-for": "198.51.100.11" }];
      for (const headers of missingOrInvalidHeaders) {
        assertEquals((await route.invoke(headers)).status, 200);
      }
      assertEquals(
        quotas.filter((quota) => quota.p_scope === route.fallback.scope).length,
        3,
      );
    }, { trustCloudflare: true }));

  for (const mode of ["denied", "unavailable"] as const) {
    Deno.test(`A8 ${route.name}: ${mode} ingress stops data reads`, () =>
      fixture(async ({ calls }) => {
        const response = await route.invoke();
        assertEquals(response.status, mode === "denied" ? 429 : 503);
        assertEquals(await response.json(), {
          error: mode === "denied"
            ? "TOO_MANY_REQUESTS"
            : "RATE_LIMIT_UNAVAILABLE",
        });
        assertEquals(
          response.headers.get("retry-after"),
          mode === "denied" ? "37" : "30",
        );
        assertEquals(calls.map((call) => new URL(call.url).pathname), [
          "/rest/v1/rpc/consume_rate_limit",
        ]);
      }, { quota: mode }));
  }
}

Deno.test("A8 missing/invalid order capabilities consume only fixed ingress, conceal existence and never log tokens", () =>
  fixture(async ({ calls, quotas }) => {
    const messages: string[] = [];
    const previousLog = console.log;
    const previousWarn = console.warn;
    const previousError = console.error;
    const capture = (...values: unknown[]) => {
      messages.push(
        values.map((value) =>
          typeof value === "string" ? value : JSON.stringify(value)
        ).join(" "),
      );
    };
    console.log = capture;
    console.warn = capture;
    console.error = capture;
    try {
      for (
        const [query, expected] of [["", 401], ["?token=", 401], [
          "?token=" + "x".repeat(2049),
          401,
        ], ["?token=synthetic-invalid-token", 404]] as const
      ) {
        calls.length = 0;
        quotas.length = 0;
        const response = await handleOrdersRequest(
          new Request(`https://edge.fixture.test/orders/${orderId}${query}`),
        );
        assertEquals(response.status, expected);
        assertEquals(await response.json(), {
          error: expected === 401 ? "MISSING_TOKEN" : "NOT_FOUND",
        });
        assertEquals(quotas.length, 1);
        assertPolicy(quotas[0], applicationRateLimits.orderReadFallback);
        assertEquals(
          quotas[0].p_key_hash,
          await hashRateLimitKey("shared:unresolved", salt),
        );
        assertEquals(
          calls.some((call) =>
            new URL(call.url).pathname === "/rest/v1/payments"
          ),
          false,
        );
      }
      assertEquals(
        messages.join("\n").includes("synthetic-invalid-token"),
        false,
      );
      assertEquals(messages.join("\n").includes("?token="), false);
    } finally {
      console.log = previousLog;
      console.warn = previousWarn;
      console.error = previousError;
    }
  }));

Deno.test("A8 successful order read counts verified order only after capability lookup", () =>
  fixture(async ({ calls, quotas }) => {
    assertEquals((await publicRoutes[0].invoke()).status, 200);
    assertEquals(quotas.length, 2);
    assertPolicy(quotas[0], applicationRateLimits.orderReadFallback);
    assertPolicy(quotas[1], applicationRateLimits.orderReadResource);
    assertEquals(
      quotas[1].p_key_hash,
      await hashRateLimitKey(`order:${orderId}`, salt),
    );
    const paths = calls.map((call) => new URL(call.url).pathname);
    assert(
      paths.indexOf("/rest/v1/orders") <
        paths.lastIndexOf("/rest/v1/rpc/consume_rate_limit"),
    );
    assert(
      paths.lastIndexOf("/rest/v1/rpc/consume_rate_limit") <
        paths.indexOf("/rest/v1/payments"),
    );
    assertEquals(JSON.stringify(quotas).includes(bookingToken), false);
  }));

for (
  const malformed of [
    null,
    [],
    [{ allowed: "true", request_count: 1, retry_after_seconds: 0 }],
    [{ allowed: false, request_count: 1, retry_after_seconds: 0 }],
    [{ allowed: false, request_count: 1, retry_after_seconds: -1 }],
    [{ allowed: false, request_count: 1, retry_after_seconds: 86401 }],
    [{ allowed: true, request_count: 0, retry_after_seconds: 0 }],
  ]
) {
  Deno.test(`A8 malformed limiter result ${JSON.stringify(malformed)} fails closed before effects`, () =>
    fixture(async ({ calls }) => {
      const response = await routes[1].invoke();
      assertEquals(response.status, 503);
      assertEquals(await response.json(), { error: "RATE_LIMIT_UNAVAILABLE" });
      assertEquals(response.headers.get("retry-after"), "30");
      assertEquals(effects(calls).length, 0);
    }, { quotaResponse: malformed }));
}

Deno.test("A8 missing limiter salt returns controlled unavailable without effects or storing keys", () =>
  fixture(async ({ calls, quotas }) => {
    Deno.env.delete("RATE_LIMIT_SALT");
    const response = await routes[1].invoke();
    assertEquals(response.status, 503);
    assertEquals(await response.json(), { error: "RATE_LIMIT_UNAVAILABLE" });
    assertEquals(quotas.length, 0);
    assertEquals(effects(calls).length, 0);
  }));

Deno.test("A8 limiter RPC failure never logs raw database error or capability URL", () =>
  fixture(async ({ calls }) => {
    const messages: string[] = [];
    const previousLog = console.log;
    const previousWarn = console.warn;
    const previousError = console.error;
    const capture = (...values: unknown[]) => {
      messages.push(
        values.map((value) =>
          typeof value === "string" ? value : JSON.stringify(value)
        ).join(" "),
      );
    };
    console.log = capture;
    console.warn = capture;
    console.error = capture;
    try {
      const response = await publicRoutes[0].invoke();
      assertEquals(response.status, 503);
      assertEquals(await response.json(), { error: "RATE_LIMIT_UNAVAILABLE" });
      const logs = messages.join("\n");
      assert(logs.includes("rate_limit_unavailable"));
      assertEquals(logs.includes(bookingToken), false);
      assertEquals(logs.includes("rpc-sensitive-fixture"), false);
      assertEquals(logs.includes("?token="), false);
      assertEquals(effects(calls).length, 0);
    } finally {
      console.log = previousLog;
      console.warn = previousWarn;
      console.error = previousError;
    }
  }, {
    quota: "unavailable",
    unavailableMessage:
      `rpc-sensitive-fixture https://edge.fixture.test/orders/${orderId}?token=${bookingToken}`,
  }));

Deno.test("A8 exceeded verified order quota returns 429 only after access check and before private reads", () =>
  fixture(async ({ calls, quotas }) => {
    const response = await publicRoutes[0].invoke();
    assertEquals(response.status, 429);
    assertEquals(await response.json(), { error: "TOO_MANY_REQUESTS" });
    assertEquals(response.headers.get("retry-after"), "37");
    assertEquals(quotas.length, 2);
    assertEquals(calls.map((call) => new URL(call.url).pathname), [
      "/rest/v1/rpc/consume_rate_limit",
      "/rest/v1/orders",
      "/rest/v1/rpc/consume_rate_limit",
    ]);
    calls.length = 0;
    quotas.length = 0;
    const invalid = await handleOrdersRequest(
      new Request(`https://edge.fixture.test/orders/${orderId}?token=invalid`),
    );
    assertEquals(invalid.status, 404);
    assertEquals(quotas.length, 1);
  }, { denyScope: applicationRateLimits.orderReadResource.scope }));

Deno.test("A8 existing accounts quota is consumed exactly once on foreign-org refusal", () =>
  fixture(async ({ calls, quotas }) => {
    const response = await handleAccounts(
      request("accounts/me", { orgId }, "DELETE"),
    );
    assertEquals(response.status, 403);
    assertEquals(quotas.length, 1);
    assertPolicy(quotas[0], accountRateLimits.deletion);
    assertEquals(effects(calls).length, 0);
  }, { member: false }));

Deno.test("A8 existing platform-admin quota is consumed exactly once before platform access refusal", () =>
  fixture(async ({ quotas }) => {
    const token = `fixture.${
      btoa(
        JSON.stringify({ aal: "aal2", session_id: "fixture-session", amr: [] }),
      )
    }.fixture`;
    const req = request("platform-admin/overview", undefined, "GET");
    req.headers.set("authorization", `Bearer ${token}`);
    const response = await handlePlatformAdminRequest(req);
    assertEquals(response.status, 403);
    assertEquals(await response.json(), { error: "PLATFORM_FORBIDDEN" });
    assertEquals(quotas.length, 1);
    assertPolicy(quotas[0], platformAdminRateLimits.api);
  }));

Deno.test("A8 existing orders/public consumes only ingress and registration quotas before denial", () =>
  fixture(async ({ calls, quotas }) => {
    const response = await handleOrdersRequest(request("orders", {
      eventId,
      buyer: { email: "fixture@example.test" },
      items: [{ eventProductId: eventId, quantity: 1 }],
      attendees: [],
      turnstileToken: "fixture-turnstile-token",
      termsAccepted: true,
      platformTermsVersion: "2026-10-01",
    }));
    assertEquals(response.status, 429);
    assertEquals(await response.json(), { error: "TOO_MANY_REQUESTS" });
    assertEquals(quotas.length, 2);
    assertPolicy(quotas[0], registerTicketsRateLimits.ingress);
    assertEquals(
      quotas[1].p_scope,
      registerTicketsRateLimits.registration.scope,
    );
    assertEquals(
      quotas[1].p_window_seconds,
      registerTicketsRateLimits.registration.windowSeconds,
    );
    assertEquals(
      calls.some((call) =>
        new URL(call.url).pathname.endsWith("create_order_intent")
      ),
      false,
    );
  }, { denyScope: registerTicketsRateLimits.registration.scope }));

Deno.test("A8 nonexistent order with plausible capability conceals existence and creates no resource counter", () =>
  fixture(async ({ quotas }) => {
    const response = await publicRoutes[0].invoke();
    assertEquals(response.status, 404);
    assertEquals(await response.json(), { error: "NOT_FOUND" });
    assertEquals(quotas.length, 1);
    assertPolicy(quotas[0], applicationRateLimits.orderReadFallback);
  }, { missingOrder: true }));

Deno.test("A8 order lookup errors never expose the booking capability or database details", () =>
  fixture(async ({ quotas }) => {
    const messages: string[] = [];
    const previousLog = console.log;
    const previousWarn = console.warn;
    const previousError = console.error;
    const capture = (...values: unknown[]) => {
      messages.push(
        values.map((value) =>
          typeof value === "string" ? value : JSON.stringify(value)
        ).join(" "),
      );
    };
    console.log = capture;
    console.warn = capture;
    console.error = capture;
    try {
      const response = await publicRoutes[0].invoke();
      assertEquals(response.status, 500);
      assertEquals(await response.json(), { error: "DB_ERROR" });
      assertEquals(quotas.length, 1);
      assertEquals(messages.join("\n").includes(bookingToken), false);
      assertEquals(messages.join("\n").includes("?token="), false);
    } finally {
      console.log = previousLog;
      console.warn = previousWarn;
      console.error = previousError;
    }
  }, {
    orderErrorMessage:
      `sensitive-db-fixture https://edge.fixture.test/orders/${orderId}?token=${bookingToken}`,
  }));
