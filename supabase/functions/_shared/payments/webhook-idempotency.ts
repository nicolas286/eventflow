import type { AdminClient } from "../supabase.ts";

export async function claimWebhookEvent(
  admin: AdminClient,
  input: {
    provider: "stripe";
    eventId: string;
    scope: "platform" | "connect";
    accountId: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  },
): Promise<"claimed" | "duplicate" | "busy"> {
  const { data, error } = await admin.rpc("claim_payment_webhook_event", {
    p_provider: input.provider,
    p_event_id: input.eventId,
    p_scope: input.scope,
    p_account_id: input.accountId,
    p_event_type: input.eventType,
    p_payload: input.payload,
  });

  if (error) throw new Error(error.message ?? "WEBHOOK_CLAIM_FAILED");

  if (typeof data !== "object" || data === null) return "busy";
  if ("should_process" in data && data.should_process === true) return "claimed";
  if ("already_processed" in data && data.already_processed === true) return "duplicate";
  return "busy";
}

export async function completeWebhookEvent(
  admin: AdminClient,
  input: {
    provider: "stripe";
    eventId: string;
    success: boolean;
    error?: string | null;
  },
) {
  const { error } = await admin.rpc("complete_payment_webhook_event", {
    p_provider: input.provider,
    p_event_id: input.eventId,
    p_success: input.success,
    p_error: input.error ?? null,
  });

  if (error) throw new Error(error.message ?? "WEBHOOK_COMPLETE_FAILED");
}

export async function claimRefundNotification(
  admin: AdminClient,
  input: { refundId: string; orderId: string },
): Promise<boolean> {
  const { data, error } = await admin.rpc("claim_payment_refund_notification", {
    p_provider: "stripe",
    p_refund_id: input.refundId,
    p_order_id: input.orderId,
  });
  if (error)
    throw new Error(error.message ?? "REFUND_NOTIFICATION_CLAIM_FAILED");
  return data === true;
}

export async function completeRefundNotification(
  admin: AdminClient,
  input: { refundId: string; success: boolean; error?: string | null },
) {
  const { error } = await admin.rpc("complete_payment_refund_notification", {
    p_provider: "stripe",
    p_refund_id: input.refundId,
    p_success: input.success,
    p_error: input.error ?? null,
  });
  if (error)
    throw new Error(error.message ?? "REFUND_NOTIFICATION_COMPLETE_FAILED");
}
