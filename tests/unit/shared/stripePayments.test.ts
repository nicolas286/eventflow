import { afterEach, describe, expect, it, vi } from "vitest";
import {
  stripeRequest,
  StripeApiError,
} from "../../../supabase/functions/_shared/payments/stripe-api";
import { verifyStripeWebhook } from "../../../supabase/functions/_shared/payments/stripe-webhook";
import {
  StripeConnectedAccountProvider,
  stripeAccountToStatus,
} from "../../../supabase/functions/_shared/payments/stripe-connect-provider";
import { StripeEventPaymentProvider } from "../../../supabase/functions/orders/public/stripe-payment-provider";
import { isStripeAccountReady } from "../../../supabase/functions/_shared/payments/stripe-connect-db";
import { humanBusinessMessage } from "../../../src/shared/errors/businessErrorMessages";

async function stripeSignature(
  body: string,
  secret: string,
  timestamp: number,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const signature = Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${signature}`;
}

afterEach(() => vi.unstubAllGlobals());

describe("Stripe webhook verification", () => {
  const body = JSON.stringify({
    id: "evt_test_1",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: "cs_test_1" } },
  });

  it("accepts a correctly signed raw payload", async () => {
    const timestamp = 1_700_000_000;
    const header = await stripeSignature(body, "whsec_test", timestamp);

    await expect(
      verifyStripeWebhook(body, header, "whsec_test", {
        nowSeconds: timestamp,
      }),
    ).resolves.toMatchObject({ id: "evt_test_1" });
  });

  it("rejects an invalid signature", async () => {
    await expect(
      verifyStripeWebhook(body, "t=1700000000,v1=bad", "whsec_test", {
        nowSeconds: 1_700_000_000,
      }),
    ).rejects.toThrow("STRIPE_SIGNATURE_INVALID");
  });

  it("rejects a replay outside the timestamp tolerance", async () => {
    const header = await stripeSignature(body, "whsec_test", 1_700_000_000);

    await expect(
      verifyStripeWebhook(body, header, "whsec_test", {
        nowSeconds: 1_700_000_301,
      }),
    ).rejects.toThrow("STRIPE_SIGNATURE_EXPIRED");
  });
});

describe("Stripe API requests", () => {
  it("scopes direct charges to the organizer connected account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cs_test_1",
          url: "https://checkout.stripe.test",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await stripeRequest("sk_test_value", "/v1/checkout/sessions", {
      method: "POST",
      connectedAccountId: "acct_test_org",
      idempotencyKey: "order_test",
      params: { mode: "payment", "metadata[eventflow_order_id]": "order_1" },
    });

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("Stripe-Account")).toBe("acct_test_org");
    expect(headers.get("Idempotency-Key")).toBe("order_test");
    expect(String(init.body)).toContain(
      "metadata%5Beventflow_order_id%5D=order_1",
    );
  });

  it("returns a safe provider error without exposing Stripe response bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: "card_declined", message: "sensitive" },
          }),
          {
            status: 402,
            headers: { "request-id": "req_test" },
          },
        ),
      ),
    );

    const error = await stripeRequest(
      "sk_test_value",
      "/v1/payment_intents",
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(StripeApiError);
    expect((error as StripeApiError).message).toBe("STRIPE_API_ERROR");
    expect((error as StripeApiError).providerStatus).toBe(402);
    expect((error as StripeApiError).stripeCode).toBe("card_declined");
    expect((error as StripeApiError).requestId).toBe("req_test");
    expect((error as StripeApiError).details).not.toContain("sensitive");
  });
});

describe("Stripe provider boundaries", () => {
  it("blocks payments until every required connected-account capability is ready", () => {
    expect(
      isStripeAccountReady({
        provider: "stripe",
        providerAccountId: "acct_test_org",
        accountType: "standard",
        controllerFeesPayer: null,
        controllerLossesPayments: null,
        controllerRequirementCollection: null,
        controllerDashboardType: null,
        requirementsDisabledReason: null,
        requirementsCurrentlyDue: [],
        configurationSupported: true,
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: false,
      }),
    ).toBe(false);
    expect(
      isStripeAccountReady({
        provider: "stripe",
        providerAccountId: "acct_test_org",
        accountType: "standard",
        controllerFeesPayer: null,
        controllerLossesPayments: null,
        controllerRequirementCollection: null,
        controllerDashboardType: null,
        requirementsDisabledReason: null,
        requirementsCurrentlyDue: [],
        configurationSupported: true,
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: true,
      }),
    ).toBe(true);
  });

  it("rejects Express accounts and accepts Standard/full-dashboard liability", () => {
    expect(
      stripeAccountToStatus({
        id: "acct_express",
        type: "express",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
      }).configurationSupported,
    ).toBe(false);
    expect(
      stripeAccountToStatus({
        id: "acct_standard",
        type: "standard",
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { currently_due: [] },
      }).configurationSupported,
    ).toBe(true);
  });

  it("maps incomplete Stripe onboarding to a buyer-safe message", () => {
    expect(humanBusinessMessage("ORG_STRIPE_ONBOARDING_INCOMPLETE")).toContain(
      "temporairement indisponibles",
    );
  });

  it("creates a Standard account so Stripe carries negative-balance liability", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "acct_test_org",
          type: "standard",
          details_submitted: false,
          charges_enabled: false,
          payouts_enabled: false,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new StripeConnectedAccountProvider("sk_test_value");
    const status = await provider.createConnectedAccount({
      orgId: "org_test",
      email: "owner@example.test",
      displayName: "Association test",
    });

    expect(status).toMatchObject({
      providerAccountId: "acct_test_org",
      detailsSubmitted: false,
    });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(init.body)).toContain("type=standard");
    expect(String(init.body)).toContain(
      "metadata%5Beventflow_org_id%5D=org_test",
    );
  });

  it("loads the real capabilities when resuming an existing account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "acct_test_org",
          type: "standard",
          details_submitted: true,
          charges_enabled: true,
          payouts_enabled: true,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new StripeConnectedAccountProvider("sk_test_value");
    await expect(
      provider.getConnectedAccountStatus("acct_test_org"),
    ).resolves.toMatchObject({ chargesEnabled: true, payoutsEnabled: true });
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/v1/accounts/acct_test_org",
    );
  });

  it("creates ticket Checkout only on the organizer connected account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "cs_test_ticket",
          url: "https://checkout.stripe.test/ticket",
          expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new StripeEventPaymentProvider(
      "sk_test_value",
      "acct_test_org",
    );
    const payment = await provider.createPayment({
      orderId: "order_test",
      orgId: "org_test",
      bookingToken: "never-send-this-token",
      amountCents: 2_500,
      totalCents: 2_500,
      currency: "EUR",
      redirectUrl: "https://app.example.test/order/order_test",
      eventTitle: "Concert test",
      buyerEmail: "buyer@example.test",
    });

    expect(payment.providerAccountId).toBe("acct_test_org");
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Headers).get("Stripe-Account")).toBe(
      "acct_test_org",
    );
    const body = new URLSearchParams(String(init.body));
    expect(body.has("payment_method_types[0]")).toBe(false);
    expect(body.get("ui_mode")).toBe("hosted_page");
    expect(body.has("integration_identifier")).toBe(false);
    expect(body.has("origin_context")).toBe(false);
    expect(body.has("expires_at")).toBe(true);
    expect(new Date(payment.orderExpiresAt).getTime()).toBe(
      new Date(payment.checkoutExpiresAt).getTime(),
    );
    expect(String(body)).not.toContain("transfer_data");
    expect(String(body)).not.toContain("on_behalf_of");
    expect(String(body)).not.toContain("never-send-this-token");
  });

  it("creates refunds on the same connected account", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "re_test", status: "succeeded" }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = new StripeEventPaymentProvider(
      "sk_test_value",
      "acct_test_org",
    );
    await provider.refundPayment({
      providerPaymentId: "pi_test",
      amountCents: 500,
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toContain("/v1/refunds");
    expect((init.headers as Headers).get("Stripe-Account")).toBe(
      "acct_test_org",
    );
    expect(String(init.body)).toContain("payment_intent=pi_test");
    expect(String(init.body)).toContain("amount=500");
  });
});
