import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../../_shared/modules/logger/mod.ts";
import { sendTicketConfirmation } from "../../_shared/services/ticket-confirmation/index.ts";

export async function sendConfirmationEmailForOrderSafe(opts: { admin: SupabaseClient; orderId: string; functionsBase: string; edgeServiceToken: string | null; logger: EdgeLogger }) {
  try {
    const { data: claimRows, error: claimErr } = await opts.admin.rpc(
      "claim_order_confirmation_email",
      {
        p_order_id: opts.orderId,
      },
    );

    if (claimErr) {
      opts.logger.error("confirmation_email_claim_failed", {
        orderId: opts.orderId,
        error: claimErr,
      });

      try {
        await opts.admin.rpc("mark_order_confirmation_email_error", {
          p_order_id: opts.orderId,
          p_error: "CLAIM_FAILED",
        });
      } catch (markErr) {
        opts.logger.error("confirmation_email_mark_error_failed", {
          orderId: opts.orderId,
          reason: "CLAIM_FAILED",
          error: markErr,
        });
      }

      return;
    }

    const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;

    if (!claim?.ok) {
      opts.logger.info("confirmation_email_not_claimed", {
        orderId: opts.orderId,
      });

      return;
    }

    await sendTicketConfirmation(opts.admin, opts.logger, opts.orderId);

    await opts.admin.rpc("mark_order_confirmation_email_sent", {
      p_order_id: opts.orderId,
    });

    opts.logger.info("confirmation_email_sent", {
      orderId: opts.orderId,
    });
  } catch (e) {
    opts.logger.error("confirmation_email_exception", {
      orderId: opts.orderId,
      error: e,
    });

    try {
      await opts.admin.rpc("mark_order_confirmation_email_error", {
        p_order_id: opts.orderId,
        p_error: "SEND_EXCEPTION",
      });
    } catch (markErr) {
      opts.logger.error("confirmation_email_mark_error_failed", {
        orderId: opts.orderId,
        reason: "SEND_EXCEPTION",
        error: markErr,
      });
    }
  }
}
