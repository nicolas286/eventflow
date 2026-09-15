import { generateTicketsPdf } from "./ticketsPdf.ts";
import { json } from "../_shared/http.ts";
import { unauthorized } from "../_shared/errors.ts";
import { createEdgeHandler } from "../_shared/edge-handler.ts";
import { createAdminClient } from "../_shared/supabase.ts";

import { resolveRuntimeConfig } from "./config.ts";
import { sendEmailOrThrow } from "../_shared/app/email.ts";
import { buildOrderConfirmationHtml } from "./templates/order-confirmation.ts";
import { parseSendConfirmationMailPayload } from "./sendConfirmationMail.contracts.ts";

import {
  buildPdfTickets,
  loadAnswersByAttendeeIdForConfirmation,
  loadAttendeesForConfirmation,
  loadEventForConfirmation,
  loadOrderForConfirmationOrThrow,
  loadOrderItemsForConfirmation,
  loadPromoCodeRedemptionRows,
  loadTicketProductMetaById,
  loadTicketsForConfirmation,
} from "./db.ts";

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

function sumDiscountCents(rows: Array<{ discount_cents?: unknown }>) {
  return rows.reduce((sum, row) => {
    const n = Number(row.discount_cents ?? 0);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

Deno.serve(
  createEdgeHandler(
    "send-confirmation-mail-tickets",
    async (req, { logger }) => {
      const config = resolveRuntimeConfig();

      assertServiceTokenOrThrow(req, config.edgeServiceToken);

      const admin = createAdminClient(config);
      const payload = await parseSendConfirmationMailPayload(req);

      if (payload.kind === "custom_mail") {
        const body = payload.data;

        await sendEmailOrThrow({
          to: body.to,
          subject: body.subject,
          html: body.isHtml ? body.content : undefined,
          text: body.isHtml ? undefined : body.content,
          tags: {
            kind: "custom_mail",
            source: "send-confirmation-mail-tickets",
          },
        });

        return json({ ok: true });
      }

      const body = payload.data;
      const orderId = body.templateData.orderId;

      const order = await loadOrderForConfirmationOrThrow(admin, orderId);

      const event = await loadEventForConfirmation(
        admin,
        order.eventId,
        logger,
      );

      const items = await loadOrderItemsForConfirmation(admin, orderId, logger);

      const redemptionRows = await loadPromoCodeRedemptionRows(
        admin,
        orderId,
        logger,
      );

      const discountCents = sumDiscountCents(redemptionRows);

      const dueCents = Math.max(
        0,
        order.totalCents - discountCents - order.paidCents,
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
        discountCents,
        paidCents: order.paidCents,
        dueCents,
      });

      const ticketRows = await loadTicketsForConfirmation(
        admin,
        orderId,
        logger,
      );

      const productIds = Array.from(
        new Set(
          ticketRows
            .map((ticket) => String(ticket.product_id ?? "").trim())
            .filter(Boolean),
        ),
      );

      const orderItemIds = Array.from(
        new Set(
          ticketRows
            .map((ticket) => String(ticket.order_item_id ?? "").trim())
            .filter(Boolean),
        ),
      );

      const [productMetaById, attendeeRows] = await Promise.all([
        loadTicketProductMetaById(admin, productIds, orderItemIds, logger),
        loadAttendeesForConfirmation(admin, orderId, logger),
      ]);

      const attendeeIds = attendeeRows.map((row) => String(row.id));

      const answersByAttendeeId = await loadAnswersByAttendeeIdForConfirmation(
        admin,
        attendeeIds,
        logger,
      );

      const tickets = buildPdfTickets({
        ticketRows,
        attendeeRows,
        answersByAttendeeId,
        productMetaById,
      });

      const pdfAttachment = tickets.length > 0
        ? await generateTicketsPdf({
          orderId,
          eventTitle: event.eventTitle,
          startsAt: event.startsAt,
          location: event.location,
          currency: order.currency,
          tickets,
        })
        : null;

      await sendEmailOrThrow({
        to: order.to,
        subject,
        html,
        attachments: pdfAttachment
          ? [{
            filename: pdfAttachment.filename,
            content: pdfAttachment.contentBase64,
            contentType: pdfAttachment.contentType,
          }]
          : [],
        tags: {
          kind: "order_confirmation",
          templateId: "order_confirmation_v1",
          orderId,
          eventId: order.eventId,
        },
      });

      return json({
        ok: true,
        sent: true,
        ticketsCount: tickets.length,
        pdfAttached: Boolean(pdfAttachment),
      });
    },
  ),
);
