import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleStripeWebhookConnect } from "../stripe-webhook-connect/index.ts";
import { completeTicketPayment, reconcileStripeCheckouts } from "../_shared/payments/stripe-checkout-lifecycle.ts";
import { findReusableProviderPayment, insertProviderPaymentOrRollback } from "../orders/public/payment-storage.ts";
import { StripeEventPaymentProvider } from "../orders/public/stripe-payment-provider.ts";
import { persistStripeAccountStatus } from "../_shared/payments/stripe-connect-db.ts";
import type { ConnectedAccountStatus } from "../_shared/payments/provider.ts";
import { expireOrders } from "../workers/expire-orders.ts";

const orderId = "92000000-0000-4000-8000-000000000001";
const url = "https://stripe-fixture.supabase.co";
const object = { id: "cs_fixture", payment_intent: "pi_fixture", amount_total: 500,
  currency: "eur", payment_status: "paid", metadata: { eventflow_order_id: orderId } };
const logger = { requestId: "fixture", info() {}, warn() {}, error() {} };

async function withFixture(run: () => Promise<void>) {
  const values = { SUPABASE_URL: url, SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service", APP_ENV: "staging",
    STRIPE_SECRET_KEY: "sk_test_fixture", STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_fixture",
    FUNCTIONS_URL: "" };
  const previous = new Map(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  const fetcher = globalThis.fetch;
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  try { await run(); } finally {
    globalThis.fetch = fetcher;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
}

async function signedRequest(type = "checkout.session.completed") {
  const body = JSON.stringify({ id: "evt_fixture", type, account: "acct_fixture",
    livemode: false, data: { object } });
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("whsec_fixture"),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const signature = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request("https://edge.fixture/stripe-webhook-connect", { method: "POST", body,
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` } });
}

Deno.test("Stripe webhook retries an interrupted fulfillment without resetting the payment receipt", () => withFixture(async () => {
  let applications = 0;
  let tickets = 0;
  const outcomes: boolean[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const args = await request.json();
    if (path.endsWith("/claim_payment_webhook_event")) return Response.json({ should_process: true });
    if (path.endsWith("/apply_stripe_checkout_payment")) {
      applications++;
      assertEquals(args.p_payment_intent_id, "pi_fixture");
      assertEquals(args.p_session_id, "cs_fixture");
      assertEquals(args.p_amount_cents, 500);
      return Response.json({ action: "paid", idempotent: applications > 1 });
    }
    if (path.endsWith("/issue_order_tickets")) {
      tickets++;
      return tickets === 1 ? Response.json({ message: "transient ticket error" }, { status: 500 }) : Response.json([]);
    }
    if (path.endsWith("/complete_payment_webhook_event")) {
      outcomes.push(args.p_success);
      return Response.json(null);
    }
    throw new Error(`Unexpected payment mutation: ${request.method} ${path}`);
  };
  assertEquals((await handleStripeWebhookConnect(await signedRequest())).status, 500);
  assertEquals((await handleStripeWebhookConnect(await signedRequest())).status, 200);
  assertEquals(applications, 2);
  assertEquals(tickets, 2);
  assertEquals(outcomes, [false, true]);
}));

Deno.test("Stripe expiry uses the guarded atomic closure instead of downgrading payments directly", () => withFixture(async () => {
  let closed = false;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/claim_payment_webhook_event")) return Response.json({ should_process: true });
    if (path.endsWith("/close_stripe_checkout")) {
      assertEquals((await request.json()).p_status, "expired");
      closed = true;
      return Response.json(null);
    }
    if (path.endsWith("/complete_payment_webhook_event")) return Response.json(null);
    throw new Error(`Unexpected call: ${path}`);
  };
  assertEquals((await handleStripeWebhookConnect(await signedRequest("checkout.session.expired"))).status, 200);
  assertEquals(closed, true);
}));

Deno.test("a processed receipt canceled before fulfillment cannot issue tickets on retry", () => withFixture(async () => {
  globalThis.fetch = (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/apply_stripe_checkout_payment")) return Promise.resolve(Response.json({ action: "ignored" }));
    throw new Error(`Unexpected fulfillment after cancellation: ${path}`);
  };
  await completeTicketPayment({ admin: createClient(url, "fixture-key"), object,
    connectedAccountId: "acct_fixture", functionsBase: null, edgeServiceToken: null, logger });
}));

Deno.test("late Stripe receipts resume the same refund and never issue tickets", () => withFixture(async () => {
  let refundId: string | null = null;
  let posts = 0;
  let gets = 0;
  let completed = false;
  let ledgerAttempts = 0;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const parsedUrl = new URL(request.url);
    if (parsedUrl.hostname === "api.stripe.com") {
      assertEquals(request.headers.get("Stripe-Account"), "acct_fixture");
      if (request.method === "GET" && parsedUrl.pathname === "/v1/refunds") {
        assertEquals(parsedUrl.searchParams.get("payment_intent"), "pi_fixture");
        return Response.json({ data: [], has_more: false });
      }
      if (request.method === "POST") {
        posts++;
        assertEquals(request.headers.get("Idempotency-Key"), "eventflow-late-checkout-pi_fixture");
        const params = new URLSearchParams(await request.text());
        assertEquals(params.get("amount"), "500");
      } else { gets++; assertEquals(parsedUrl.pathname, "/v1/refunds/re_fixture"); }
      return Response.json({ id: "re_fixture", status: "succeeded", amount: 500,
        currency: "eur", payment_intent: "pi_fixture" });
    }
    if (parsedUrl.pathname.endsWith("/apply_stripe_checkout_payment")) {
      return Response.json({ action: "refund", refund_id: refundId });
    }
    if (parsedUrl.pathname.endsWith("/record_stripe_late_refund")) {
      const args = await request.json();
      refundId = args.p_refund_id;
      completed ||= args.p_succeeded === true;
      return Response.json(null);
    }
    if (parsedUrl.pathname.endsWith("/apply_stripe_order_refund")) {
      ledgerAttempts++;
      return ledgerAttempts === 1 ? Response.json({ message: "ledger unavailable" }, { status: 500 }) : Response.json({ ok: true });
    }
    throw new Error(`Unexpected call (no tickets on expired orders): ${parsedUrl.pathname}`);
  };
  const input = { admin: createClient(url, "fixture-key"), object, connectedAccountId: "acct_fixture",
    functionsBase: null, edgeServiceToken: null, logger };
  await assertRejects(() => completeTicketPayment(input), Error, "STRIPE_LATE_REFUND_APPLY_FAILED");
  assertEquals(completed, false);
  await completeTicketPayment(input);
  assertEquals({ posts, gets, completed, ledgerAttempts }, { posts: 1, gets: 1, completed: true, ledgerAttempts: 2 });
}));

Deno.test("Stripe reconciliation preserves open or settling sessions and closes only provider-confirmed expiry", () => withFixture(async () => {
  const closed: string[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/get_stripe_checkouts_to_reconcile")) {
      return Response.json(["open", "settling", "expired"].map((state) => ({
        order_id: orderId, account_id: "acct_fixture", session_id: `cs_${state}`,
      })));
    }
    if (path.startsWith("/v1/checkout/sessions/")) {
      const id = path.split("/").at(-1)!;
      return Response.json({ id, metadata: { eventflow_order_id: orderId },
        status: id === "cs_settling" ? "complete" : id.slice(3), payment_status: "unpaid" });
    }
    if (path.endsWith("/close_stripe_checkout")) {
      closed.push((await request.json()).p_session_id);
      return Response.json(null);
    }
    throw new Error(`Unexpected reconciliation mutation: ${path}`);
  };
  await reconcileStripeCheckouts(createClient(url, "fixture-key"), logger);
  assertEquals(closed, ["cs_expired"]);
}));

Deno.test("Stripe reconciliation checks order metadata and preserves stock when Stripe is unavailable", () => withFixture(async () => {
  let mutations = 0;
  globalThis.fetch = (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/get_stripe_checkouts_to_reconcile")) return Promise.resolve(Response.json([
      { order_id: orderId, account_id: "acct_fixture", session_id: "cs_wrong" },
      { order_id: orderId, account_id: "acct_fixture", session_id: "cs_unavailable" },
    ]));
    if (path.endsWith("/cs_wrong")) return Promise.resolve(Response.json({ id: "cs_wrong", status: "expired",
      metadata: { eventflow_order_id: "another-order" } }));
    if (path.endsWith("/cs_unavailable")) return Promise.resolve(Response.json({}, { status: 503 }));
    mutations++;
    throw new Error(`Unexpected mutation: ${path}`);
  };
  await reconcileStripeCheckouts(createClient(url, "fixture-key"), logger);
  assertEquals(mutations, 0);
}));

Deno.test("Stripe storage closes checkout if the order cannot be reserved atomically", () => withFixture(async () => {
  let expired = false;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/register_stripe_checkout_payment")) {
      assertEquals((await request.json()).p_expires_at, 2_000_000_000);
      return Response.json({ message: "ORDER_NOT_PAYABLE" }, { status: 400 });
    }
    if (path === "/v1/checkout/sessions/cs_fixture/expire") { expired = true; return Response.json({ id: "cs_fixture" }); }
    throw new Error(`Unexpected call: ${path}`);
  };
  await assertRejects(() => insertProviderPaymentOrRollback({ admin: createClient(url, "fixture-key"),
    provider: new StripeEventPaymentProvider(
      "sk_test_fixture",
      "acct_fixture",
      "pmc_fixture",
    ),
    payment: { provider: "stripe", providerAccountId: "acct_fixture", providerPaymentId: "cs_fixture",
      providerCheckoutSessionId: "cs_fixture", checkoutUrl: "https://checkout.stripe.test", raw: { expires_at: 2_000_000_000 } },
    orderId, amountCents: 500, currency: "EUR" }), Error, "PAYMENT_DB_INSERT_FAILED");
  assertEquals(expired, true);
}));

Deno.test("late Stripe receipts recover a lost refund response and reject partial refunds", () => withFixture(async () => {
  let amount = 500;
  let recorded = 0;
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/apply_stripe_checkout_payment")) return Response.json({ action: "refund", refund_id: null });
    if (path === "/v1/refunds" && request.method === "GET") return Response.json({ has_more: false,
      data: [{ id: "re_recovered", status: "succeeded", payment_intent: "pi_fixture", currency: "eur", amount }] });
    if (path.endsWith("/record_stripe_late_refund")) { recorded++; return Response.json(null); }
    if (path.endsWith("/apply_stripe_order_refund")) {
      assertEquals((await request.json()).p_amount_cents, 500);
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected call (must not create a second refund): ${request.method} ${path}`);
  };
  const input = { admin: createClient(url, "fixture-key"), object, connectedAccountId: "acct_fixture",
    functionsBase: null, edgeServiceToken: null, logger };
  await completeTicketPayment(input);
  assertEquals(recorded, 2);
  amount = 100;
  await assertRejects(() => completeTicketPayment(input), Error, "STRIPE_LATE_REFUND_REVIEW_REQUIRED");
  assertEquals(recorded, 2);
}));

Deno.test("Stripe Checkout creation reuses the reserved deadline and idempotency key", () => withFixture(async () => {
  const bodies: string[] = [];
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assertEquals(new URL(request.url).pathname, "/v1/checkout/sessions");
    assertEquals(request.headers.get("Stripe-Account"), "acct_fixture");
    assertEquals(request.headers.get("Idempotency-Key"), `eventflow-order-${orderId}`);
    const body = await request.text();
    bodies.push(body);
    const params = new URLSearchParams(body);
    assertEquals(params.get("expires_at"), "2000000000");
    assertEquals(params.get("metadata[eventflow_org_id]"), inputOrgId);
    assertEquals(params.has("payment_intent_data[transfer_data][destination]"), false);
    return Response.json({ id: "cs_fixture", url: "https://checkout.stripe.test", expires_at: 2_000_000_000 });
  };
  const provider = new StripeEventPaymentProvider(
    "sk_test_fixture",
    "acct_fixture",
    "pmc_fixture",
  );
  const inputOrgId = "92000000-0000-4000-8000-000000000002";
  const input = { orderId, orgId: inputOrgId, bookingToken: "synthetic", amountCents: 500,
    totalCents: 1000, currency: "EUR", redirectUrl: "https://eventflow.test/confirmation",
    eventTitle: "Fixture", buyerEmail: "buyer@example.test", checkoutExpiresAt: 2_000_000_000 };
  await provider.createPayment(input);
  await provider.createPayment(input);
  assertEquals(bodies[0], bodies[1]);
}));

Deno.test("a reusable Checkout is scoped to the organization's current account", () => withFixture(async () => {
  let accountFilter: string | null = null;
  globalThis.fetch = (input) => {
    accountFilter = new URL(String(input)).searchParams.get("provider_account_id");
    return Promise.resolve(Response.json([]));
  };
  const result = await findReusableProviderPayment(
    createClient(url, "fixture-key"), orderId, "stripe", "acct_fixture",
  );
  assertEquals(result, null);
  assertEquals(accountFilter, "eq.acct_fixture");
}));

Deno.test("a stale Stripe account status cannot replace a rotated account", () => withFixture(async () => {
  let guardedUpdate = false;
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    const parsedUrl = new URL(request.url);
    if (request.method === "GET") {
      return Promise.resolve(Response.json({ payments_provider: "stripe", stripe_connected_account_id: "acct_fixture" }));
    }
    guardedUpdate = parsedUrl.searchParams.get("stripe_connected_account_id") === "eq.acct_fixture";
    return Promise.resolve(Response.json({ code: "PGRST116", details: "The result contains 0 rows",
      message: "Cannot coerce the result to a single JSON object" }, { status: 406 }));
  };
  const status: ConnectedAccountStatus = {
    provider: "stripe", providerAccountId: "acct_fixture", accountType: "standard",
    controllerFeesPayer: null, controllerLossesPayments: null,
    controllerRequirementCollection: null, controllerDashboardType: null,
    requirementsDisabledReason: null, requirementsCurrentlyDue: [],
    configurationSupported: true, detailsSubmitted: true,
    chargesEnabled: true, payoutsEnabled: true,
  };
  await assertRejects(() => persistStripeAccountStatus(
    createClient(url, "fixture-key"), orderId, status,
    { expectedAccountId: "acct_fixture" },
  ), Error, "STRIPE_ACCOUNT_CHANGED");
  assertEquals(guardedUpdate, true);
}));

Deno.test("first Connect persistence cannot overwrite a concurrently connected account", () => withFixture(async () => {
  let writes = 0;
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    if (request.method === "GET") {
      return Promise.resolve(Response.json({ payments_provider: "stripe", stripe_connected_account_id: null }));
    }
    writes++;
    assertEquals(new URL(request.url).searchParams.get("stripe_connected_account_id"), "is.null");
    // Another request attached an account after the read: PostgREST updates no row.
    return Promise.resolve(Response.json({ code: "PGRST116", details: "The result contains 0 rows",
      message: "Cannot coerce the result to a single JSON object" }, { status: 406 }));
  };
  const status: ConnectedAccountStatus = {
    provider: "stripe", providerAccountId: "acct_new", accountType: "standard",
    controllerFeesPayer: null, controllerLossesPayments: null,
    controllerRequirementCollection: null, controllerDashboardType: null,
    requirementsDisabledReason: null, requirementsCurrentlyDue: [],
    configurationSupported: true, detailsSubmitted: false,
    chargesEnabled: false, payoutsEnabled: false,
  };
  await assertRejects(() => persistStripeAccountStatus(
    createClient(url, "fixture-key"), orderId, status, { expectedAccountId: null },
  ), Error, "STRIPE_ACCOUNT_CHANGED");
  assertEquals(writes, 1);
}));

Deno.test("Stripe reconciliation failure cannot block other order expiry", () => withFixture(async () => {
  const previous = Deno.env.get("CRON_SECRET");
  Deno.env.set("CRON_SECRET", "fixture-cron");
  let expired = false;
  globalThis.fetch = (input) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/get_stripe_checkouts_to_reconcile")) return Promise.resolve(Response.json({ message: "unavailable" }, { status: 500 }));
    if (path.endsWith("/expire_orders")) { expired = true; return Promise.resolve(Response.json({ expired_orders: 1 })); }
    throw new Error(`Unexpected call: ${path}`);
  };
  try {
    const response = await expireOrders(new Request("https://edge.test/workers/expire-orders", {
      method: "POST", headers: { "x-cron-secret": "fixture-cron" },
    }), createClient(url, "fixture-key"));
    assertEquals(response.status, 200);
    assertEquals(expired, true);
  } finally {
    if (previous === undefined) Deno.env.delete("CRON_SECRET"); else Deno.env.set("CRON_SECRET", previous);
  }
}));
