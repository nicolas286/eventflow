import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { assertInternalEdgeAuthentication } from "../_shared/app/internal-edge/mod.ts";
import { ResponseError } from "../_shared/errors.ts";
import { serializeError } from "../_shared/modules/logger/mod.ts";
import {
  claimEmailOnceOrThrow,
  loadEventForConfirmation,
  loadOrderForConfirmationOrThrow,
  loadOrderItemsForConfirmation,
} from "./db.ts";
import { sendEmailOrThrow } from "../_shared/app/email.ts";

import { parseSendConfirmationMailPayload } from "./sendConfirmationMail.contracts.ts";
import { buildOrderConfirmationHtml } from "./templates/order-confirmation.ts";
import { resolveRuntimeConfig } from "./config.ts";

export const handleSendConfirmationMailRequest = createEdgeHandler(
  {
    name: "send-confirmation-mail",
    method: "POST",
    auth: "none",
    serviceClient: true,
    onError: ({ req, logger, error }) => {
      if (error instanceof ResponseError) {
        logger.warn("response_error", {
          code: error.code,
          status: error.status,
        });
        return json(req, { error: error.code }, error.status);
      }

      logger.error("unexpected_error", { error: serializeError(error) });
      return json(req, { error: "UNEXPECTED_ERROR" }, 500);
    },
  },
  async ({ req, logger, serviceClient: admin }) => {
    const config = resolveRuntimeConfig();
    const authenticationSource = await assertInternalEdgeAuthentication(
      req,
      config.edgeServiceToken,
      { allowLegacyServiceToken: true },
    );
    logger.info("worker_authenticated", { source: authenticationSource });

    const payload = await parseSendConfirmationMailPayload(req);

    if (payload.kind === "order_confirmation") {
      const body = payload.data;
      const orderId = body.templateData.orderId;

      const order = await loadOrderForConfirmationOrThrow(admin, orderId);

      const event = await loadEventForConfirmation(
        admin,
        order.eventId,
      );

      const items = await loadOrderItemsForConfirmation(
        admin,
        orderId,
        logger,
      );

      const orderUrl = `${config.appBaseUrl}/order/${orderId}?token=${
        encodeURIComponent(
          order.bookingToken,
        )
      }`;

      const subject = body.subject ||
        `Inscription confirmée – ${event.eventTitle}`;

      const html = buildOrderConfirmationHtml({
        eventTitle: event.eventTitle,
        startsAt: event.startsAt,
        location: event.location,
        description: event.description,
        orderUrl,
        currency: order.currency,
        items,
        totalCents: order.totalCents,
        paidCents: order.paidCents,
      });

      const canSend = await claimEmailOnceOrThrow(admin, {
        orderId,
        kind: "confirmation_v1",
        logger,
      });

      if (!canSend) {
        return json(req, {
          ok: true,
          skipped: "already_sent",
        });
      }

      await sendEmailOrThrow({
        to: order.to,
        subject,
        html,
      });

      return json(req, {
        ok: true,
        sent: true,
      });
    }

    const body = payload.data;

    await sendEmailOrThrow({
      to: body.to,
      subject: body.subject,
      html: body.isHtml ? body.content : undefined,
      text: body.isHtml ? undefined : body.content,
    });

    return json(req, {
      ok: true,
    });
  },
);

Deno.serve(handleSendConfirmationMailRequest);
