import {
  loadEventForConfirmation,
  loadOrderForConfirmationOrThrow,
} from "./db.ts";
import { sendEmailOrThrow } from "../../app/email.ts";

import { buildBankTransferInstructionsHtml } from "./templates/bank-transfer-instructions.ts";
import { resolveRuntimeConfig } from "./config.ts";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../../modules/logger/mod.ts";
import { z } from "zod";
import { bankTransferInstructionsSchema } from "../../../../../shared/schemas/bank-transfer.ts";

export async function sendBankTransferInstructions(
  admin: SupabaseClient,
  logger: EdgeLogger,
  input: {
    orderId: string;
    beneficiary: string;
    iban: string;
    amountCents: number;
    currency: string;
    communication: string;
    internalReference: string;
    paymentDueAt: string | null;
  },
) {
  const { data: claim, error: claimError } = await admin.rpc(
    "claim_bank_transfer_email",
    {
      p_order_id: input.orderId,
    },
  );
  if (claimError) throw new Error("BANK_TRANSFER_EMAIL_CLAIM_FAILED");
  if (!claim?.claimed) {
    return { ok: true, skipped: String(claim?.reason ?? "in_progress") };
  }
  const claimToken = z.uuid().parse(claim.claimToken);

  try {
    const config = resolveRuntimeConfig();
    const order = await loadOrderForConfirmationOrThrow(admin, input.orderId);
    const event = await loadEventForConfirmation(admin, order.eventId);
    const orderUrl = `${config.appBaseUrl}/order/${input.orderId}?token=${
      encodeURIComponent(order.bookingToken)
    }`;

    await sendEmailOrThrow({
      to: order.to,
      subject: `Instructions de paiement – ${event.eventTitle}`,
      html: buildBankTransferInstructionsHtml({
        eventTitle: event.eventTitle,
        startsAt: event.startsAt,
        location: event.location,
        orderUrl,
        amountCents: input.amountCents,
        currency: input.currency,
        beneficiary: input.beneficiary,
        iban: input.iban,
        communication: input.communication,
        internalReference: input.internalReference,
        paymentDueAt: input.paymentDueAt,
      }),
      tags: {
        kind: "bank_transfer_instructions",
        templateId: "bank_transfer_instructions_v1",
        orderId: input.orderId,
        eventId: order.eventId,
      },
      idempotencyKey: `bank-transfer-instructions:${input.orderId}`,
    });

    const { data: completed, error } = await admin.rpc(
      "complete_bank_transfer_email",
      {
        p_order_id: input.orderId,
        p_claim_token: claimToken,
        p_success: true,
      },
    );
    if (error || !completed) {
      throw new Error("BANK_TRANSFER_EMAIL_COMPLETION_FAILED");
    }
    return { ok: true, sent: true };
  } catch (error) {
    // Store only a safe code. Neither provider errors nor bank details belong in logs.
    try {
      const { error: completionError } = await admin.rpc(
        "complete_bank_transfer_email",
        {
          p_order_id: input.orderId,
          p_claim_token: claimToken,
          p_success: false,
        },
      );
      if (completionError) {
        logger.error("bank_transfer_email_failure_save_failed", {
          orderId: input.orderId,
        });
      }
    } catch {
      logger.error("bank_transfer_email_failure_save_failed", {
        orderId: input.orderId,
      });
    }
    throw error;
  }
}

const pendingInstructionsSchema = bankTransferInstructionsSchema.extend({
  orderId: z.uuid(),
});

// Reuse the authenticated reminders cron so a failed first delivery has a real
// retry path without requiring the buyer to create another reservation.
export async function retryBankTransferInstructions(
  admin: SupabaseClient,
  logger: EdgeLogger,
) {
  const { data, error } = await admin.rpc("list_pending_bank_transfer_emails", {
    p_limit: 25,
  });
  if (error) {
    logger.error("bank_transfer_email_retry_load_failed");
    return { sent: 0, failed: 1 };
  }
  let sent = 0;
  let failed = 0;
  for (const raw of Array.isArray(data) ? data : []) {
    const parsed = pendingInstructionsSchema.safeParse(raw);
    if (!parsed.success) {
      failed++;
      continue;
    }
    try {
      const result = await sendBankTransferInstructions(
        admin,
        logger,
        parsed.data,
      );
      if ("sent" in result && result.sent) sent++;
    } catch {
      failed++;
      logger.error("bank_transfer_email_retry_failed", {
        orderId: parsed.data.orderId,
      });
    }
  }
  return { sent, failed };
}
