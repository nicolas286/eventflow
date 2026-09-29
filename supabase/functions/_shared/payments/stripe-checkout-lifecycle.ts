import { z } from "zod";
import type { AdminClient } from "../supabase.ts";
import type { EdgeLogger } from "../modules/logger/mod.ts";
import { assertStripeApiKey } from "../environment-safety.ts";
import { envTrim } from "../config.ts";
import { stripeRequest, requireStripeId } from "./stripe-api.ts";
import { sendConfirmationEmailForOrderSafe } from "../../orders/public/emails.ts";

export type StripeCheckoutObject = Record<string, unknown> & {
  id?: string;
  metadata?: Record<string, unknown>;
};

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
}

const appliedPaymentSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("ignored") }),
  z.object({ action: z.literal("paid"), idempotent: z.boolean() }),
  z.object({ action: z.literal("refund"), refund_id: z.string().nullable() }),
]);

const refundSchema = z.object({
  id: z.string().startsWith("re_"), payment_intent: z.string(),
  amount: z.number().int().positive(), currency: z.string(), status: z.string(),
}).passthrough();

async function refundLatePayment(input: {
  admin: AdminClient;
  accountId: string;
  paymentIntentId: string;
  orderId: string;
  amountCents: number;
  currency: string;
  refundId: string | null;
}) {
  const secretKey = envTrim("STRIPE_SECRET_KEY");
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY_MISSING");
  assertStripeApiKey(secretKey);
  let refund;
  if (input.refundId) {
    refund = await stripeRequest(secretKey, `/v1/refunds/${encodeURIComponent(input.refundId)}`, {
      connectedAccountId: input.accountId, timeoutMs: 30_000,
    });
  } else {
    // Recover a lost POST response even after Stripe's idempotency retention.
    // Partial/manual refunds need review rather than a second full refund.
    const previous = z.object({ data: z.array(refundSchema), has_more: z.boolean() }).parse(
      await stripeRequest(secretKey, "/v1/refunds", {
        connectedAccountId: input.accountId, timeoutMs: 30_000,
        params: { payment_intent: input.paymentIntentId, limit: 100 },
      }),
    );
    if (previous.has_more || previous.data.length > 1) throw new Error("STRIPE_LATE_REFUND_REVIEW_REQUIRED");
    refund = previous.data[0] ?? await stripeRequest(secretKey, "/v1/refunds", {
      method: "POST", connectedAccountId: input.accountId, timeoutMs: 30_000,
      idempotencyKey: `eventflow-late-checkout-${input.paymentIntentId}`,
      params: { payment_intent: input.paymentIntentId, amount: input.amountCents,
        "metadata[eventflow_late_order_id]": input.orderId },
    });
  }
  const parsed = refundSchema.parse(refund);
  if (parsed.payment_intent !== input.paymentIntentId || parsed.amount !== input.amountCents ||
      parsed.currency.toUpperCase() !== input.currency.toUpperCase()) {
    throw new Error("STRIPE_LATE_REFUND_REVIEW_REQUIRED");
  }
  const refundId = requireStripeId(parsed.id, "STRIPE_REFUND_ID_MISSING");
  const { error: recordError } = await input.admin.rpc("record_stripe_late_refund", {
    p_account_id: input.accountId,
    p_payment_intent_id: input.paymentIntentId,
    p_refund_id: refundId,
  });
  if (recordError) throw new Error("STRIPE_LATE_REFUND_RECORD_FAILED");
  if (refund.status === "failed" || refund.status === "canceled") {
    throw new Error("STRIPE_LATE_REFUND_REVIEW_REQUIRED");
  }
  if (refund.status === "succeeded") {
    const { error } = await input.admin.rpc("apply_stripe_order_refund", {
      p_order_id: input.orderId, p_account_id: input.accountId, p_refund_id: refundId,
      p_original_payment_id: input.paymentIntentId, p_amount_cents: input.amountCents,
      p_currency: input.currency, p_status: "succeeded", p_raw: refund,
    });
    if (error) throw new Error("STRIPE_LATE_REFUND_APPLY_FAILED");
    const { error: completedError } = await input.admin.rpc("record_stripe_late_refund", {
      p_account_id: input.accountId, p_payment_intent_id: input.paymentIntentId,
      p_refund_id: refundId, p_succeeded: true,
    });
    if (completedError) throw new Error("STRIPE_LATE_REFUND_COMPLETE_FAILED");
  }
}

export async function completeTicketPayment(input: {
  admin: AdminClient;
  object: StripeCheckoutObject;
  connectedAccountId: string;
  functionsBase: string | null;
  edgeServiceToken: string | null;
  logger: EdgeLogger;
}) {
  const orderId = requiredString(input.object.metadata?.eventflow_order_id, "STRIPE_ORDER_METADATA_MISSING");
  const sessionId = requiredString(input.object.id, "STRIPE_OBJECT_ID_MISSING");
  const paymentIntentId = requiredString(input.object.payment_intent, "STRIPE_PAYMENT_INTENT_ID_MISSING");
  const amountCents = input.object.amount_total;
  const currency = requiredString(input.object.currency, "STRIPE_PAYMENT_CURRENCY_MISSING").toUpperCase();
  if (!Number.isSafeInteger(amountCents) || typeof amountCents !== "number" || amountCents <= 0) {
    throw new Error("STRIPE_PAYMENT_AMOUNT_INVALID");
  }
  const { data, error } = await input.admin.rpc("apply_stripe_checkout_payment", {
    p_order_id: orderId, p_account_id: input.connectedAccountId, p_session_id: sessionId,
    p_payment_intent_id: paymentIntentId, p_amount_cents: amountCents,
    p_currency: currency, p_raw: input.object,
  });
  if (error) throw new Error(`APPLY_STRIPE_PAYMENT_FAILED:${error.message}`);
  const result = appliedPaymentSchema.parse(data);
  if (result.action === "ignored") return;
  if (result.action === "refund") {
    await refundLatePayment({ admin: input.admin, orderId, accountId: input.connectedAccountId,
      paymentIntentId, amountCents, currency, refundId: result.refund_id });
    return;
  }
  const { error: ticketError } = await input.admin.rpc("issue_order_tickets", { p_order_id: orderId });
  if (ticketError) throw new Error(`ISSUE_ORDER_TICKETS_FAILED:${ticketError.message}`);
  if (input.functionsBase) {
    await sendConfirmationEmailForOrderSafe({ admin: input.admin, orderId,
      functionsBase: input.functionsBase, edgeServiceToken: input.edgeServiceToken, logger: input.logger });
  }
}

export async function markTicketPaymentStatus(input: {
  admin: AdminClient;
  object: StripeCheckoutObject;
  connectedAccountId: string;
  status: "failed" | "expired";
}) {
  const orderId = requiredString(input.object.metadata?.eventflow_order_id, "STRIPE_ORDER_METADATA_MISSING");
  const sessionId = requiredString(input.object.id, "STRIPE_OBJECT_ID_MISSING");
  const { error } = await input.admin.rpc("close_stripe_checkout", {
    p_order_id: orderId, p_account_id: input.connectedAccountId,
    p_session_id: sessionId, p_status: input.status, p_raw: input.object,
  });
  if (error) throw new Error(`STRIPE_CHECKOUT_CLOSE_FAILED:${error.message}`);
}

const reconciliationRowsSchema = z.array(z.object({
  order_id: z.string().uuid(), account_id: z.string(), session_id: z.string(),
}));

/** A missed expiry webhook must not strand stock. Never infer expiry from time
 * alone: a completed async payment may still be settling with Stripe. */
export async function reconcileStripeCheckouts(admin: AdminClient, logger: EdgeLogger) {
  const secretKey = envTrim("STRIPE_SECRET_KEY");
  if (!secretKey) return;
  assertStripeApiKey(secretKey);
  const { data, error } = await admin.rpc("get_stripe_checkouts_to_reconcile", { p_limit: 20 });
  if (error) throw new Error("STRIPE_CHECKOUT_RECONCILIATION_LOAD_FAILED");
  await Promise.all(reconciliationRowsSchema.parse(data ?? []).map(async (checkout) => {
    try {
      const object = await stripeRequest(secretKey,
        `/v1/checkout/sessions/${encodeURIComponent(checkout.session_id)}`, {
          connectedAccountId: checkout.account_id, timeoutMs: 10_000,
        });
      const parsed = z.object({
        id: z.literal(checkout.session_id),
        metadata: z.object({ eventflow_order_id: z.literal(checkout.order_id) }),
      }).passthrough().parse(object);
      if (object.status === "complete" && object.payment_status === "paid") {
        await completeTicketPayment({ admin, object: parsed, connectedAccountId: checkout.account_id,
          functionsBase: envTrim("FUNCTIONS_URL"), edgeServiceToken: envTrim("EDGE_SERVICE_TOKEN"), logger });
      } else if (object.status === "expired") {
        await markTicketPaymentStatus({ admin, object: parsed,
          connectedAccountId: checkout.account_id, status: "expired" });
      }
    } catch (error) {
      // Keep the reservation on provider/network uncertainty, and try next run.
      logger.error("stripe_checkout_reconciliation_failed", { orderId: checkout.order_id,
        error: error instanceof Error ? error.message : "UNEXPECTED" });
    }
  }));
}
