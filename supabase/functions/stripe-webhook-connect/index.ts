import { envTrim, resolveSupabaseRuntimeConfig } from "../_shared/config.ts";
import { createEdgeLogger, serializeError } from "../_shared/logger.ts";
import { json } from "../_shared/http.ts";
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
import { sendConfirmationEmailForOrderSafe } from "../register-tickets/emails.ts";
import { createAdminClient, type AdminClient } from "../_shared/supabase.ts";

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

function metadataValue(object: StripeObject, key: string) {
  return stringValue(object.metadata?.[key]);
}

async function verifyOrderAccount(
  admin: AdminClient,
  orderId: string,
  connectedAccountId: string,
) {
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("org_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order?.org_id) throw new Error("ORDER_NOT_FOUND");

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("stripe_connected_account_id")
    .eq("id", order.org_id)
    .maybeSingle();
  if (orgError || org?.stripe_connected_account_id !== connectedAccountId) {
    throw new Error("STRIPE_CONNECTED_ACCOUNT_MISMATCH");
  }
}

async function completeTicketPayment(input: {
  admin: AdminClient;
  object: StripeObject;
  connectedAccountId: string;
  eventType: string;
  functionsBase: string | null;
  edgeServiceToken: string | null;
  logger: ReturnType<typeof createEdgeLogger>;
}) {
  const orderId = metadataValue(input.object, "eventflow_order_id");
  if (!orderId) throw new Error("STRIPE_ORDER_METADATA_MISSING");

  await verifyOrderAccount(input.admin, orderId, input.connectedAccountId);

  const objectId = stringValue(input.object.id);
  if (!objectId) throw new Error("STRIPE_OBJECT_ID_MISSING");

  const isCheckout = objectId.startsWith("cs_");
  const paymentIntentId = isCheckout
    ? stringValue(input.object.payment_intent)
    : objectId;

  if (!paymentIntentId) {
    if (input.eventType === "checkout.session.completed") return;
    throw new Error("STRIPE_PAYMENT_INTENT_ID_MISSING");
  }

  let query = input.admin
    .from("payments")
    .select(
      "id, amount_cents, currency, provider_payment_id, provider_checkout_session_id",
    )
    .eq("provider", "stripe")
    .eq("order_id", orderId)
    .eq("provider_account_id", input.connectedAccountId)
    .eq("is_refund", false);

  if (isCheckout) query = query.eq("provider_checkout_session_id", objectId);

  const { data: payment, error: paymentError } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (paymentError || !payment) throw new Error("STRIPE_PAYMENT_ROW_NOT_FOUND");

  const eventAmount = isCheckout
    ? numberValue(input.object.amount_total)
    : (numberValue(input.object.amount_received) ??
      numberValue(input.object.amount));
  const eventCurrency = stringValue(input.object.currency)?.toUpperCase();

  if (eventAmount !== payment.amount_cents) {
    throw new Error("STRIPE_PAYMENT_AMOUNT_MISMATCH");
  }
  if (eventCurrency !== String(payment.currency).toUpperCase()) {
    throw new Error("STRIPE_PAYMENT_CURRENCY_MISMATCH");
  }

  const { error: updateError } = await input.admin
    .from("payments")
    .update({
      provider_payment_id: paymentIntentId,
      provider_checkout_session_id: isCheckout
        ? objectId
        : payment.provider_checkout_session_id,
      status: "pending",
      raw: input.object,
      updated_at: new Date().toISOString(),
    })
    .eq("id", payment.id);
  if (updateError) throw new Error("STRIPE_PAYMENT_UPDATE_FAILED");

  const { error: applyError } = await input.admin.rpc("apply_order_payment", {
    p_order_id: orderId,
    p_provider: "stripe",
    p_amount_cents: payment.amount_cents,
    p_currency: payment.currency,
    p_provider_payment_id: paymentIntentId,
    p_raw: input.object,
    p_note: null,
  });
  if (applyError)
    throw new Error(`APPLY_ORDER_PAYMENT_FAILED:${applyError.message}`);

  const { error: ticketError } = await input.admin.rpc("issue_order_tickets", {
    p_order_id: orderId,
  });
  if (ticketError)
    throw new Error(`ISSUE_ORDER_TICKETS_FAILED:${ticketError.message}`);

  if (input.functionsBase) {
    await sendConfirmationEmailForOrderSafe({
      admin: input.admin,
      orderId,
      functionsBase: input.functionsBase,
      edgeServiceToken: input.edgeServiceToken,
      logger: input.logger,
    });
  }
}

async function markTicketPaymentStatus(input: {
  admin: AdminClient;
  object: StripeObject;
  connectedAccountId: string;
  status: "failed" | "expired";
}) {
  const orderId = metadataValue(input.object, "eventflow_order_id");
  if (!orderId) return;
  await verifyOrderAccount(input.admin, orderId, input.connectedAccountId);

  let query = input.admin
    .from("payments")
    .update({
      status: input.status,
      raw: input.object,
      updated_at: new Date().toISOString(),
    })
    .eq("provider", "stripe")
    .eq("order_id", orderId)
    .eq("provider_account_id", input.connectedAccountId)
    .eq("is_refund", false);

  const objectId = stringValue(input.object.id);
  if (objectId?.startsWith("cs_")) {
    query = query.eq("provider_checkout_session_id", objectId);
  }

  const { error } = await query;
  if (error) throw new Error("STRIPE_PAYMENT_STATUS_UPDATE_FAILED");
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

  const { error } = await input.admin.rpc("apply_order_refund", {
    p_order_id: original.order_id,
    p_provider: "stripe",
    p_refund_id: refundId,
    p_original_payment_id: paymentIntentId,
    p_amount_cents: amount,
    p_currency: currency,
    p_status: status,
    p_raw: input.object,
  });
  if (error) throw new Error(`APPLY_ORDER_REFUND_FAILED:${error.message}`);
}

async function syncAccount(admin: AdminClient, object: StripeObject) {
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
    inputLogger.warn("stripe_account_not_ready", { accountId, orgId: org.id });
  }
}

const inputLogger = createEdgeLogger("stripe-webhook-connect");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);

  const rawBody = await req.text();
  const webhookSecret = envTrim("STRIPE_CONNECT_WEBHOOK_SECRET");
  if (!webhookSecret) return json({ error: "SERVER_MISCONFIGURED" }, 500);

  let event;
  try {
    event = await verifyStripeWebhook(
      rawBody,
      req.headers.get("stripe-signature"),
      webhookSecret,
    );
  } catch (error) {
    inputLogger.warn("signature_rejected", serializeError(error));
    return json({ error: "INVALID_SIGNATURE" }, 400);
  }

  if (isRestrictedEnvironment() && event.livemode) {
    return json({ error: "LIVE_PAYMENTS_DISABLED" }, 400);
  }

  const connectedAccountId =
    stringValue(event.account) ??
    (event.type === "account.updated"
      ? stringValue(event.data.object.id)
      : null);
  if (!connectedAccountId)
    return json({ error: "CONNECTED_ACCOUNT_MISSING" }, 400);

  const config = resolveSupabaseRuntimeConfig();
  const admin = createAdminClient(config);

  try {
    const shouldProcess = await claimWebhookEvent(admin, {
      provider: "stripe",
      eventId: event.id,
      scope: "connect",
      accountId: connectedAccountId,
      eventType: event.type,
      payload: event as unknown as Record<string, unknown>,
    });
    if (!shouldProcess) return json({ received: true, duplicate: true });

    const object = event.data.object as StripeObject;
    if (
      event.type === "checkout.session.completed" &&
      object.payment_status === "paid"
    ) {
      await completeTicketPayment({
        admin,
        object,
        connectedAccountId,
        eventType: event.type,
        functionsBase: envTrim("FUNCTIONS_URL"),
        edgeServiceToken: envTrim("EDGE_SERVICE_TOKEN"),
        logger: inputLogger,
      });
    } else if (event.type === "checkout.session.async_payment_succeeded") {
      await completeTicketPayment({
        admin,
        object,
        connectedAccountId,
        eventType: event.type,
        functionsBase: envTrim("FUNCTIONS_URL"),
        edgeServiceToken: envTrim("EDGE_SERVICE_TOKEN"),
        logger: inputLogger,
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
      await syncAccount(admin, object);
    }

    await completeWebhookEvent(admin, {
      provider: "stripe",
      eventId: event.id,
      success: true,
    });

    return json({ received: true });
  } catch (error) {
    inputLogger.error("processing_failed", serializeError(error));
    try {
      await completeWebhookEvent(admin, {
        provider: "stripe",
        eventId: event.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } catch (completionError) {
      inputLogger.error(
        "failure_state_save_failed",
        serializeError(completionError),
      );
    }
    return json({ error: "WEBHOOK_PROCESSING_FAILED" }, 500);
  }
});
