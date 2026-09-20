import { generateTicketsPdf } from "./ticketsPdf.ts";

import { resolveRuntimeConfig } from "./config.ts";
import { sendEmailOrThrow } from "../../app/email.ts";
import { buildOrderConfirmationHtml } from "./templates/order-confirmation.ts";

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

function sumDiscountCents(rows: Array<{ discount_cents?: unknown }>) {
  return rows.reduce((sum, row) => {
    const n = Number(row.discount_cents ?? 0);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../../modules/logger/mod.ts";

export async function sendTicketConfirmation(
  admin: SupabaseClient,
  logger: EdgeLogger,
  orderId: string,
  subjectOverride?: string,
) {
  const config = resolveRuntimeConfig();
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

  const subject = subjectOverride ||
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

  return {
    ok: true,
    sent: true,
    ticketsCount: tickets.length,
    pdfAttached: Boolean(pdfAttachment),
  };
}
