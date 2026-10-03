import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../../_shared/modules/logger/mod.ts";
import { prepareTicketConfirmation } from "../../_shared/services/ticket-confirmation/index.ts";
import { sendEmailOrThrow } from "../../_shared/app/email.ts";
import { isMailCaptureEnabled } from "../../_shared/mail/capture.ts";

// Replay the stored envelope verbatim, including sender and PDF bytes.
const envelopeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  subject: z.string().min(1),
  html: z.string(),
  attachments: z.array(
    z.object({
      filename: z.string(),
      content: z.string(),
      contentType: z.string(),
    }),
  ),
  tags: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
});
const claimSchema = z.discriminatedUnion("claimed", [
  z.object({ claimed: z.literal(false), reason: z.string() }),
  z.object({
    claimed: z.literal(true),
    claimToken: z.uuid(),
    payload: z.unknown().nullable(),
    provider: z.enum(["resend", "capture"]).nullable(),
  }),
]);
const dispatchSchema = z.object({
  payload: envelopeSchema,
  provider: z.enum(["resend", "capture"]),
  dispatchBefore: z.iso.datetime({ offset: true }),
});

export type ConfirmationDeliveryResult = "sent" | "skipped" | "failed";

export async function sendConfirmationEmailForOrderSafe(opts: {
  admin: SupabaseClient;
  orderId: string;
  logger: EdgeLogger;
}): Promise<ConfirmationDeliveryResult> {
  let claimToken: string | undefined;
  let failureCode = "CONFIRMATION_CLAIM_FAILED";
  try {
    const { data, error } = await opts.admin.rpc(
      "claim_order_confirmation_delivery",
      {
        p_order_id: opts.orderId,
      },
    );
    if (error) throw new Error("CONFIRMATION_CLAIM_FAILED");
    const claim = claimSchema.parse(data);
    if (!claim.claimed) {
      const fields = { orderId: opts.orderId, reason: claim.reason };
      if (["review_required", "legacy_unknown"].includes(claim.reason)) {
        opts.logger.error("confirmation_email_review_required", fields);
      } else opts.logger.info("confirmation_email_not_claimed", fields);
      return "skipped";
    }
    claimToken = claim.claimToken;
    failureCode = "CONFIRMATION_PREPARATION_FAILED";
    const provider = isMailCaptureEnabled() ? "capture" : "resend";
    if (claim.provider && claim.provider !== provider) {
      throw new Error("CONFIRMATION_PROVIDER_CHANGED");
    }
    const payload = claim.payload ?? (await prepareTicketConfirmation(
      opts.admin,
      opts.logger,
      opts.orderId,
    )).email;
    const envelope = envelopeSchema.parse(payload);
    failureCode = "CONFIRMATION_DISPATCH_NOT_AUTHORIZED";
    const { data: dispatchData, error: dispatchError } = await opts.admin.rpc(
      "prepare_order_confirmation_dispatch",
      {
        p_order_id: opts.orderId,
        p_claim_token: claimToken,
        p_payload: envelope,
        p_provider: provider,
      },
    );
    if (dispatchError || !dispatchData) {
      throw new Error("CONFIRMATION_DISPATCH_NOT_AUTHORIZED");
    }
    const dispatch = dispatchSchema.parse(dispatchData);
    // 10s provider timeout, plus margin. Never begin a request at the deadline.
    if (
      dispatch.provider !== provider ||
      Date.parse(dispatch.dispatchBefore) <= Date.now() + 30_000
    ) {
      throw new Error("CONFIRMATION_DISPATCH_WINDOW_CLOSED");
    }
    failureCode = "CONFIRMATION_DELIVERY_FAILED";
    const delivery = await sendEmailOrThrow({
      ...dispatch.payload,
      idempotencyKey: `order-confirmation:${opts.orderId}`,
    });
    failureCode = "CONFIRMATION_ACCEPTED_MARK_FAILED";
    const { data: completed, error: completionError } = await opts.admin.rpc(
      "complete_order_confirmation_delivery",
      {
        p_order_id: opts.orderId,
        p_claim_token: claimToken,
        p_success: true,
        p_provider_message_id: delivery.id,
      },
    );
    if (completionError || completed !== true) {
      throw new Error("CONFIRMATION_MARK_SENT_FAILED");
    }
    opts.logger.info("confirmation_email_sent", {
      orderId: opts.orderId,
      provider: delivery.provider,
    });
    return "sent";
  } catch {
    // Payment/tickets are already committed. Only delivery is retried. Store
    // safe codes, never provider responses, recipient, token, or envelope.
    const code = failureCode;
    opts.logger.error("confirmation_email_failed", {
      orderId: opts.orderId,
      code,
    });
    if (claimToken) {
      try {
        const { data, error } = await opts.admin.rpc(
          "complete_order_confirmation_delivery",
          {
            p_order_id: opts.orderId,
            p_claim_token: claimToken,
            p_success: false,
            p_error_code: code,
          },
        );
        if (error || data !== true) {
          opts.logger.error("confirmation_email_failure_save_failed", {
            orderId: opts.orderId,
          });
        }
      } catch {
        opts.logger.error("confirmation_email_failure_save_failed", {
          orderId: opts.orderId,
        });
      }
    }
    // If even failure persistence failed, the durable claim expires in 5min.
    return "failed";
  }
}

export async function retryOrderConfirmations(
  admin: SupabaseClient,
  logger: EdgeLogger,
) {
  const { data, error } = await admin.rpc("list_pending_order_confirmations", {
    p_limit: 25,
  });
  if (error) throw new Error("CONFIRMATION_RETRY_LOAD_FAILED");
  const rows = z.array(z.object({ order_id: z.uuid() })).parse(data);
  const result = { sent: 0, failed: 0, skipped: 0 };
  for (const row of rows) {
    const outcome = await sendConfirmationEmailForOrderSafe({
      admin,
      logger,
      orderId: row.order_id,
    });
    result[outcome]++;
  }
  return result;
}
