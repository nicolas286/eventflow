import { badGateway } from "../../_shared/errors.ts";
import type {
  CreatedEventPayment,
  CreateEventPaymentInput,
  EventPaymentProvider,
} from "../../_shared/payments/provider.ts";
import {
  requireStripeId,
  type StripeRecord,
  stripeRequest,
} from "../../_shared/payments/stripe-api.ts";

type StripeCheckoutSession = StripeRecord & {
  url?: string | null;
  payment_intent?: string | null;
  expires_at?: number | null;
};

export const STRIPE_CHECKOUT_LIFETIME_SECONDS = 35 * 60;

export class StripeEventPaymentProvider implements EventPaymentProvider {
  readonly name = "stripe" as const;

  constructor(
    private readonly secretKey: string,
    private readonly connectedAccountId: string,
  ) {}

  async createPayment(
    input: CreateEventPaymentInput,
  ): Promise<CreatedEventPayment> {
    const productName = input.eventTitle?.trim() || "Billet Eventflow";
    const cancelUrl = new URL(input.redirectUrl);
    cancelUrl.searchParams.set("payment", "cancelled");
    const expiresAt =
      input.checkoutExpiresAt ??
      Math.floor(Date.now() / 1000) + STRIPE_CHECKOUT_LIFETIME_SECONDS;

    // Direct charge: the Checkout Session and PaymentIntent are created in the
    // organizer's connected account. No platform subscription/customer is used.
    const session = await stripeRequest<StripeCheckoutSession>(
      this.secretKey,
      "/v1/checkout/sessions",
      {
        method: "POST",
        connectedAccountId: this.connectedAccountId,
        idempotencyKey: `eventflow-order-${input.orderId}`,
        timeoutMs: 30_000,
        params: {
          expires_at: expiresAt,
          ui_mode: "hosted_page",
          mode: "payment",
          "payment_method_types[0]": "bancontact",
          billing_address_collection: "auto",
          "phone_number_collection[enabled]": false,
          "automatic_tax[enabled]": false,
          allow_promotion_codes: false,
          submit_type: "auto",
          success_url: input.redirectUrl,
          cancel_url: cancelUrl.toString(),
          client_reference_id: input.orderId,
          customer_email: input.buyerEmail,
          "line_items[0][quantity]": 1,
          "line_items[0][price_data][currency]": input.currency.toLowerCase(),
          "line_items[0][price_data][unit_amount]": input.amountCents,
          "line_items[0][price_data][product_data][name]": productName.slice(
            0,
            250,
          ),
          "metadata[eventflow_order_id]": input.orderId,
          "metadata[eventflow_org_id]": input.orgId,
          "metadata[eventflow_payment_kind]":
            input.amountCents < input.totalCents ? "deposit" : "full",
          "payment_intent_data[metadata][eventflow_order_id]": input.orderId,
          "payment_intent_data[metadata][eventflow_org_id]": input.orgId,
          "payment_intent_data[metadata][eventflow_payment_kind]":
            input.amountCents < input.totalCents ? "deposit" : "full",
        },
      },
    );

    const sessionId = requireStripeId(
      session.id,
      "STRIPE_CHECKOUT_SESSION_ID_MISSING",
    );
    if (typeof session.url !== "string" || !session.url) {
      throw badGateway("STRIPE_CHECKOUT_URL_MISSING");
    }
    if (
      typeof session.expires_at !== "number" ||
      !Number.isInteger(session.expires_at) ||
      session.expires_at <= Math.floor(Date.now() / 1000)
    ) {
      throw badGateway("STRIPE_CHECKOUT_EXPIRY_MISSING");
    }

    const checkoutExpiresAt = new Date(session.expires_at * 1000).toISOString();
    const orderExpiresAt = checkoutExpiresAt;

    return {
      provider: "stripe",
      providerPaymentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : sessionId,
      providerAccountId: this.connectedAccountId,
      providerCheckoutSessionId: sessionId,
      checkoutUrl: session.url,
      checkoutExpiresAt,
      orderExpiresAt,
      raw: session,
    };
  }

  async getPayment(providerPaymentId: string) {
    const prefix = providerPaymentId.startsWith("cs_")
      ? "/v1/checkout/sessions/"
      : "/v1/payment_intents/";
    return await stripeRequest<StripeRecord>(
      this.secretKey,
      `${prefix}${encodeURIComponent(providerPaymentId)}`,
      { connectedAccountId: this.connectedAccountId },
    );
  }

  async refundPayment(input: {
    providerPaymentId: string;
    amountCents?: number;
  }) {
    return await stripeRequest<StripeRecord>(this.secretKey, "/v1/refunds", {
      method: "POST",
      connectedAccountId: this.connectedAccountId,
      idempotencyKey: `eventflow-refund-${input.providerPaymentId}-${
        input.amountCents ?? "full"
      }`,
      params: {
        payment_intent: input.providerPaymentId,
        amount: input.amountCents,
      },
    });
  }

  async rollbackPayment(providerPaymentId: string) {
    if (!providerPaymentId.startsWith("cs_")) return;

    try {
      await stripeRequest<StripeRecord>(
        this.secretKey,
        `/v1/checkout/sessions/${encodeURIComponent(providerPaymentId)}/expire`,
        {
          method: "POST",
          connectedAccountId: this.connectedAccountId,
        },
      );
    } catch {
      // Best effort only: the database error remains the primary failure.
    }
  }
}
