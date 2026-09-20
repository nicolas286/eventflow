import {
  claimEmailOnceOrThrow,
  loadEventForConfirmation,
  loadOrderForConfirmationOrThrow,
  loadOrderItemsForConfirmation,
} from "./db.ts";
import { sendEmailOrThrow } from "../../app/email.ts";

import { buildOrderConfirmationHtml } from "./templates/order-confirmation.ts";
import { resolveRuntimeConfig } from "./config.ts";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../../modules/logger/mod.ts";

export async function sendOrderConfirmation(
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
    paidCents: order.paidCents,
  });

  const canSend = await claimEmailOnceOrThrow(admin, {
    orderId,
    kind: "confirmation_v1",
    logger,
  });

  if (!canSend) {
    return {
      ok: true,
      skipped: "already_sent",
    };
  }

  await sendEmailOrThrow({
    to: order.to,
    subject,
    html,
  });

  return {
    ok: true,
    sent: true,
  };
}
