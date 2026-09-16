import { postInternalEdgeJson } from "../_shared/app/internal-edge/mod.ts";

export async function sendConfirmationEmailForOrderSafe(opts) {
  if (!opts.edgeServiceToken) {
    opts.logger.error("confirmation_email_skipped_missing_service_token", {
      orderId: opts.orderId,
    });

    return;
  }

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

    const result = await postInternalEdgeJson<{ ok?: boolean }>({
      functionsBase: opts.functionsBase,
      path: "/send-confirmation-mail-tickets",
      serviceToken: opts.edgeServiceToken,
      timeoutMs: 10_000,
      body: {
        templateId: "order_confirmation_v1",
        templateData: {
          orderId: opts.orderId,
        },
      },
    });

    if (!result.ok || !result.data?.ok) {
      opts.logger.error("confirmation_email_send_failed", {
        orderId: opts.orderId,
        status: result.status,
        response: result.data,
      });

      await opts.admin.rpc("mark_order_confirmation_email_error", {
        p_order_id: opts.orderId,
        p_error: "SEND_FAILED",
      });

      return;
    }

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
