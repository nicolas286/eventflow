import {
  BodyTooLargeError,
  readLimitedText,
} from "../_shared/app/request-body.ts";
import { STRIPE_WEBHOOK_MAX_BODY_BYTES } from "../_shared/payments/stripe-connect-http.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { envTrim } from "../_shared/config.ts";
import {
  serializeError,
  type EdgeLogger,
} from "../_shared/modules/logger/mod.ts";
import { assertStripeWebhookMode } from "../_shared/environment-safety.ts";
import { verifyStripeWebhook } from "../_shared/payments/stripe-webhook.ts";
import {
  claimWebhookEvent,
  claimRefundNotification,
  completeRefundNotification,
  completeWebhookEvent,
} from "../_shared/payments/webhook-idempotency.ts";
import {
  isStripeAccountReady,
  persistStripeAccountStatus,
} from "../_shared/payments/stripe-connect-db.ts";
import { stripeAccountToStatus } from "../_shared/payments/stripe-connect-provider.ts";
import {
  completeTicketPayment,
  markTicketPaymentStatus,
} from "../_shared/payments/stripe-checkout-lifecycle.ts";
import type { AdminClient } from "../_shared/supabase.ts";
import { sendEmailOrThrow } from "../_shared/app/email.ts";
import { formatMoney } from "../_shared/format.ts";
import { escapeHtml } from "../_shared/text.ts";

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
  logger: EdgeLogger;
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

  const { data: refundResult, error } = await input.admin.rpc(
    "apply_stripe_order_refund",
    {
      p_order_id: original.order_id,
      p_account_id: input.connectedAccountId,
      p_refund_id: refundId,
      p_original_payment_id: paymentIntentId,
      p_amount_cents: amount,
      p_currency: currency,
      p_status: status,
      p_raw: input.object,
    },
  );
  if (error) throw new Error(`APPLY_ORDER_REFUND_FAILED:${error.message}`);

  const { error: completedError } = await input.admin.rpc(
    "record_stripe_late_refund",
    {
      p_account_id: input.connectedAccountId,
      p_payment_intent_id: paymentIntentId,
      p_refund_id: refundId,
      p_succeeded: true,
    },
  );
  if (completedError) throw new Error("STRIPE_LATE_REFUND_COMPLETE_FAILED");

  const shouldNotify = await claimRefundNotification(input.admin, {
    refundId,
    orderId: String(original.order_id),
  });
  if (!shouldNotify) return;

  try {
    const { data: order, error: orderError } = await input.admin
      .from("orders")
      .select("buyer_email, event_id, org_id")
      .eq("id", original.order_id)
      .maybeSingle();
    if (orderError || !order?.buyer_email) {
      throw new Error("REFUND_NOTIFICATION_ORDER_NOT_FOUND");
    }

    const [{ data: event }, { data: profile }] = await Promise.all([
      input.admin
        .from("events")
        .select("title")
        .eq("id", order.event_id)
        .maybeSingle(),
      input.admin
        .from("organization_profile")
        .select("display_name, public_email")
        .eq("org_id", order.org_id)
        .maybeSingle(),
    ]);
    const organizerName = String(profile?.display_name ?? "L’organisateur");
    const organizerEmail = stringValue(profile?.public_email);
    const fullyRefunded = Boolean(
      refundResult &&
      typeof refundResult === "object" &&
      "fully_refunded" in refundResult &&
      (refundResult as { fully_refunded?: unknown }).fully_refunded,
    );

    await sendEmailOrThrow({
      to: String(order.buyer_email),
      replyTo: organizerEmail ?? undefined,
      subject: `${fullyRefunded ? "Remboursement" : "Remboursement partiel"} – ${String(event?.title ?? "votre réservation")}`,
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.6;color:#111">
        <h2>${fullyRefunded ? "Votre réservation a été remboursée" : "Un remboursement partiel a été effectué"}</h2>
        <p>Montant remboursé : <strong>${escapeHtml(formatMoney(amount, currency.toUpperCase()))}</strong>.</p>
        <p>Vendeur et organisateur : <strong>${escapeHtml(organizerName)}</strong>.</p>
        ${fullyRefunded ? "<p>Les billets liés à cette réservation ne sont désormais plus valables.</p>" : "<p>La réservation et ses billets restent valables.</p>"}
        ${organizerEmail ? `<p>Question ? Contactez l’organisateur : <a href="mailto:${escapeHtml(organizerEmail)}">${escapeHtml(organizerEmail)}</a>.</p>` : ""}
      </div>`,
      idempotencyKey: `stripe-refund-${refundId}`,
      tags: {
        kind: "refund_confirmation",
        refundId,
        orderId: String(original.order_id),
      },
    });
    await completeRefundNotification(input.admin, { refundId, success: true });
  } catch (notificationError) {
    input.logger.error("refund_notification_failed", {
      refundId,
      orderId: original.order_id,
      error: serializeError(notificationError),
    });
    await completeRefundNotification(input.admin, {
      refundId,
      success: false,
      error:
        notificationError instanceof Error
          ? notificationError.message
          : String(notificationError),
    });
    throw notificationError;
  }
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

  const status = stripeAccountToStatus({ ...object, id: accountId });
  await persistStripeAccountStatus(admin, org.id, status, {
    expectedAccountId: accountId,
  });

  if (!isStripeAccountReady(status)) {
    logger.warn("stripe_account_not_ready", { accountId, orgId: org.id });
  }
}

async function markAccountDeauthorized(admin: AdminClient, accountId: string) {
  const { error } = await admin
    .from("organizations")
    .update({
      stripe_details_submitted: false,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
      stripe_compliance_verified: false,
      stripe_migration_required: true,
      stripe_deauthorized_at: new Date().toISOString(),
      payments_status: "revoked",
      payments_live_ready: false,
      payments_account_updated_at: new Date().toISOString(),
    })
    .eq("stripe_connected_account_id", accountId);

  if (error) throw new Error("STRIPE_ACCOUNT_DEAUTHORIZATION_SAVE_FAILED");
}

export const handleStripeWebhookConnect = createEdgeHandler(
  {
    name: "stripe-webhook-connect",
    method: "POST",
    auth: "none",
    serviceClient: true,
  },
  async ({ req, logger, serviceClient: admin }) => {
    let rawBody: string;
    try {
      // Pass the unchanged text to signature verification before JSON parsing.
      rawBody = await readLimitedText(req, STRIPE_WEBHOOK_MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return json(req, { error: "PAYLOAD_TOO_LARGE" }, 413);
      }
      throw error;
    }
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

    try {
      assertStripeWebhookMode(event.livemode);
    } catch (error) {
      return json(
        req,
        {
          error:
            error instanceof Error ? error.message : "PAYMENT_MODE_MISMATCH",
        },
        400,
      );
    }

    const connectedAccountId =
      stringValue(event.account) ??
      (event.type === "account.updated"
        ? stringValue(event.data.object.id)
        : null);
    if (!connectedAccountId)
      return json(req, { error: "CONNECTED_ACCOUNT_MISSING" }, 400);

    try {
      const claim = await claimWebhookEvent(admin, {
        provider: "stripe",
        eventId: event.id,
        scope: "connect",
        accountId: connectedAccountId,
        eventType: event.type,
        payload: event as unknown as Record<string, unknown>,
      });
      if (claim === "duplicate") {
        return json(req, { received: true, duplicate: true });
      }
      if (claim === "busy") {
        return json(req, { error: "WEBHOOK_PROCESSING_IN_PROGRESS" }, 503);
      }
    } catch (error) {
      logger.error("claim_failed", { error: serializeError(error) });
      return json(req, { error: "WEBHOOK_CLAIM_FAILED" }, 503);
    }

    try {
      const object = event.data.object as StripeObject;
      if (
        event.type === "checkout.session.completed" &&
        object.payment_status === "paid"
      ) {
        await completeTicketPayment({
          admin,
          object,
          connectedAccountId,
          logger,
        });
      } else if (event.type === "checkout.session.async_payment_succeeded") {
        await completeTicketPayment({
          admin,
          object,
          connectedAccountId,
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
        await applyRefund({ admin, object, connectedAccountId, logger });
      } else if (event.type === "account.updated") {
        await syncAccount(admin, object, logger);
      } else if (event.type === "account.application.deauthorized") {
        await markAccountDeauthorized(admin, connectedAccountId);
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
