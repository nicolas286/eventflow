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
): Promise<boolean> {
  const { data, error } = await admin.rpc("claim_payment_webhook_event", {
    p_provider: input.provider,
    p_event_id: input.eventId,
    p_scope: input.scope,
    p_account_id: input.accountId,
    p_event_type: input.eventType,
    p_payload: input.payload,
  });

  if (error) throw new Error(error.message ?? "WEBHOOK_CLAIM_FAILED");

  return Boolean(
    typeof data === "object" &&
    data !== null &&
    "should_process" in data &&
    (data as { should_process?: unknown }).should_process,
  );
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
