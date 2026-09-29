import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { envTrim } from "../_shared/config.ts";
import {
  serializeError,
  type EdgeLogger,
} from "../_shared/modules/logger/mod.ts";
import { isRestrictedEnvironment } from "../_shared/environment-safety.ts";
import { verifyStripeWebhook } from "../_shared/payments/stripe-webhook.ts";
import {
  claimWebhookEvent,
  completeWebhookEvent,
} from "../_shared/payments/webhook-idempotency.ts";
import {
  isStripeAccountReady,
  persistStripeAccountStatus,
} from "../_shared/payments/stripe-connect-db.ts";
import { completeTicketPayment, markTicketPaymentStatus } from "../_shared/payments/stripe-checkout-lifecycle.ts";
import type { AdminClient } from "../_shared/supabase.ts";

type StripeObject = Record<string, unknown> & {
  id?: string;
  metadata?: Record<string, unknown>;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function applyRefund(input: {
  admin: AdminClient;
  object: StripeObject;
  connectedAccountId: string;
}) {
  const refundId = stringValue(input.object.id);
  const paymentIntentId = stringValue(input.object.payment_intent);
  const amount = numberValue(input.object.amount);
  const currency = stringValue(input.object.currency);
  const status = stringValue(input.object.status);

  if (!refundId || !paymentIntentId || !amount || !currency || !status) return;
  if (status !== "succeeded") return;

  const { data: original, error: originalError } = await input.admin
    .from("payments")
    .select("order_id")
    .eq("provider", "stripe")
    .eq("provider_account_id", input.connectedAccountId)
    .eq("provider_payment_id", paymentIntentId)
    .eq("type", "payment")
    .maybeSingle();
  if (originalError || !original?.order_id) {
    throw new Error("STRIPE_REFUND_ORIGINAL_PAYMENT_NOT_FOUND");
  }

  const { error } = await input.admin.rpc("apply_stripe_order_refund", {
    p_order_id: original.order_id,
    p_account_id: input.connectedAccountId,
    p_refund_id: refundId,
    p_original_payment_id: paymentIntentId,
    p_amount_cents: amount,
    p_currency: currency,
    p_status: status,
    p_raw: input.object,
  });
  if (error) throw new Error(`APPLY_ORDER_REFUND_FAILED:${error.message}`);
  const { error: completedError } = await input.admin.rpc("record_stripe_late_refund", {
    p_account_id: input.connectedAccountId, p_payment_intent_id: paymentIntentId,
    p_refund_id: refundId, p_succeeded: true,
  });
  if (completedError) throw new Error("STRIPE_LATE_REFUND_COMPLETE_FAILED");
}

async function syncAccount(
  admin: AdminClient,
  object: StripeObject,
  logger: EdgeLogger,
) {
  const accountId = stringValue(object.id);
  if (!accountId) throw new Error("STRIPE_ACCOUNT_ID_MISSING");

  const { data: org, error } = await admin
    .from("organizations")
    .select("id")
    .eq("stripe_connected_account_id", accountId)
    .maybeSingle();
  if (error) throw new Error("STRIPE_ACCOUNT_ORG_LOOKUP_FAILED");
  if (!org?.id) return;

  const status = {
    provider: "stripe" as const,
    providerAccountId: accountId,
    detailsSubmitted: object.details_submitted === true,
    chargesEnabled: object.charges_enabled === true,
    payoutsEnabled: object.payouts_enabled === true,
  };
  await persistStripeAccountStatus(admin, org.id, status);

  if (!isStripeAccountReady(status)) {
    logger.warn("stripe_account_not_ready", { accountId, orgId: org.id });
  }
}

export const handleStripeWebhookConnect = createEdgeHandler(
  {
    name: "stripe-webhook-connect",
    method: "POST",
    auth: "none",
    serviceClient: true,
  },
  async ({ req, logger, serviceClient: admin }) => {
    const rawBody = await req.text();
    const webhookSecret = envTrim("STRIPE_CONNECT_WEBHOOK_SECRET");
    if (!webhookSecret) {
      return json(req, { error: "SERVER_MISCONFIGURED" }, 500);
    }

    let event;
    try {
      event = await verifyStripeWebhook(
        rawBody,
        req.headers.get("stripe-signature"),
        webhookSecret,
      );
    } catch (error) {
      logger.warn("signature_rejected", { error: serializeError(error) });
      return json(req, { error: "INVALID_SIGNATURE" }, 400);
    }

    if (isRestrictedEnvironment() && event.livemode) {
      return json(req, { error: "LIVE_PAYMENTS_DISABLED" }, 400);
    }

    const connectedAccountId =
      stringValue(event.account) ??
      (event.type === "account.updated"
        ? stringValue(event.data.object.id)
        : null);
    if (!connectedAccountId)
      return json(req, { error: "CONNECTED_ACCOUNT_MISSING" }, 400);

    try {
      const shouldProcess = await claimWebhookEvent(admin, {
        provider: "stripe",
        eventId: event.id,
        scope: "connect",
        accountId: connectedAccountId,
        eventType: event.type,
        payload: event as unknown as Record<string, unknown>,
      });
      if (!shouldProcess) {
        return json(req, { received: true, duplicate: true });
      }

      const object = event.data.object as StripeObject;
      if (
        event.type === "checkout.session.completed" &&
        object.payment_status === "paid"
      ) {
        await completeTicketPayment({
          admin,
          object,
          connectedAccountId,
          functionsBase: envTrim("FUNCTIONS_URL"),
          edgeServiceToken: envTrim("EDGE_SERVICE_TOKEN"),
          logger,
        });
      } else if (event.type === "checkout.session.async_payment_succeeded") {
        await completeTicketPayment({
          admin,
          object,
          connectedAccountId,
          functionsBase: envTrim("FUNCTIONS_URL"),
          edgeServiceToken: envTrim("EDGE_SERVICE_TOKEN"),
          logger,
        });
      } else if (event.type === "checkout.session.async_payment_failed") {
        await markTicketPaymentStatus({
          admin,
          object,
          connectedAccountId,
          status: "failed",
        });
      } else if (event.type === "checkout.session.expired") {
        await markTicketPaymentStatus({
          admin,
          object,
          connectedAccountId,
          status: "expired",
        });
      } else if (
        event.type === "refund.created" ||
        event.type === "refund.updated"
      ) {
        await applyRefund({ admin, object, connectedAccountId });
      } else if (event.type === "account.updated") {
        await syncAccount(admin, object, logger);
      }

      await completeWebhookEvent(admin, {
        provider: "stripe",
        eventId: event.id,
        success: true,
      });

      return json(req, { received: true });
    } catch (error) {
      logger.error("processing_failed", { error: serializeError(error) });
      try {
        await completeWebhookEvent(admin, {
          provider: "stripe",
          eventId: event.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (completionError) {
        logger.error("failure_state_save_failed", {
          error: serializeError(completionError),
        });
      }
      return json(req, { error: "WEBHOOK_PROCESSING_FAILED" }, 500);
    }
  },
);

if (import.meta.main) Deno.serve(handleStripeWebhookConnect);
