import { createEdgeHandler } from "../_shared/edge-handler.ts";
import { json } from "../_shared/http.ts";
import { unauthorized } from "../_shared/errors.ts";
import {
  claimEmailOnceOrThrow,
  loadEventForConfirmation,
  loadOrderForConfirmationOrThrow,
  loadOrderItemsForConfirmation,
} from "./db.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { sendEmailOrThrow } from "../_shared/app/email.ts";

import { parseSendConfirmationMailPayload } from "./sendConfirmationMail.contracts.ts";
import { buildOrderConfirmationHtml } from "./templates/order-confirmation.ts";
import { resolveRuntimeConfig } from "./config.ts";

function trimHeader(req: Request, name: string) {
  const v = req.headers.get(name) ?? "";
  const t = v.trim();
  return t || null;
}

function assertServiceTokenOrThrow(req: Request, expected: string) {
  const received = trimHeader(req, "x-service-token");

  if (!received || received !== expected) {
    throw unauthorized("UNAUTHORIZED");
  }
}

Deno.serve(
  createEdgeHandler("send-confirmation-mail", async (req, { logger }) => {
    const config = resolveRuntimeConfig();

    assertServiceTokenOrThrow(req, config.edgeServiceToken);

    const admin = createAdminClient(config);
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
        return json({
          ok: true,
          skipped: "already_sent",
        });
      }

      await sendEmailOrThrow({
        to: order.to,
        subject,
        html,
      });

      return json({
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

    return json({
      ok: true,
    });
  }),
);
