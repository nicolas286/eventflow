import { json } from "../_shared/http.ts";
import { unauthorized } from "../_shared/errors.ts";
import { createEdgeHandler } from "../_shared/edge-handler.ts";
import { createAdminClient } from "../_shared/supabase.ts";
import { sendEmailOrThrow } from "../_shared/app/email.ts";

import { resolveRuntimeConfig } from "./config.ts";
import { parseSendReminderMailPayload } from "./sendReminderMail.contracts.ts";
import { buildOrderReminderHtml } from "./templates/order-reminder.ts";

import {
  loadOrderDiscountCents,
  loadOrderForReminderOrNull,
  loadOrderItemsForReminder,
  loadReminderCandidateOrders,
  loadReminderDaysByOrgId,
  logReminderEmailOnce,
  looksLikeEmail,
  type ReminderCandidateOrder,
  type ReminderOrderContext,
} from "./db.ts";

function trimHeader(req: Request, name: string) {
  const value = req.headers.get(name) ?? "";
  const trimmed = value.trim();
  return trimmed || null;
}

function assertServiceTokenOrThrow(req: Request, expected: string) {
  const received = trimHeader(req, "x-service-token");

  if (!received || received !== expected) {
    throw unauthorized("UNAUTHORIZED");
  }
}

function toInt(value: unknown, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function brusselsDateKey(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Brussels",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shouldSendToday(startsAtIso: string, reminderDays: number) {
  const starts = new Date(startsAtIso);
  if (!Number.isFinite(starts.getTime())) return false;

  const days = toInt(reminderDays, 0);
  if (days < 0) return false;

  const target = new Date(starts);
  target.setUTCDate(target.getUTCDate() - days);

  return brusselsDateKey(new Date()) === brusselsDateKey(target);
}

function isCandidateValid(candidate: ReminderCandidateOrder) {
  return Boolean(
    candidate.orderId &&
      looksLikeEmail(candidate.buyerEmail) &&
      candidate.bookingToken &&
      candidate.startsAt,
  );
}

function isInsideCronHorizon(startsAtIso: string, now: Date, max: Date) {
  const starts = new Date(startsAtIso);

  if (!Number.isFinite(starts.getTime())) return false;
  if (starts.getTime() < now.getTime() - 6 * 60 * 60 * 1000) return false;
  if (starts.getTime() > max.getTime()) return false;

  return true;
}

async function buildAndMaybeSendReminder(input: {
  admin: any;
  appBaseUrl: string;
  order: ReminderOrderContext;
  logger: any;
  debug?: boolean;
}) {
  const { admin, appBaseUrl, order, logger, debug = false } = input;

  if (
    !looksLikeEmail(order.buyerEmail) || !order.bookingToken || !order.startsAt
  ) {
    return {
      status: "invalid" as const,
      detail: "missing_fields",
    };
  }

  // Très important : un dry-run ne doit pas consommer l'idempotence.
  if (!debug) {
    const logged = await logReminderEmailOnce(admin, order.orderId, logger);

    if (!logged) {
      return {
        status: "already_sent" as const,
      };
    }
  }

  const items = await loadOrderItemsForReminder(admin, order.orderId, logger);

  const orderUrl = `${appBaseUrl}/order/${order.orderId}?token=${
    encodeURIComponent(
      order.bookingToken,
    )
  }`;

  const subject = `Rappel – ${order.eventTitle}`;

  const html = buildOrderReminderHtml({
    eventTitle: order.eventTitle,
    startsAt: order.startsAt,
    location: order.location,
    description: order.description,
    orderUrl,
    reminderDays: order.reminderDays,
    currency: order.currency,
    items,
    totalCents: order.totalCents,
    discountCents: order.discountCents,
    paidCents: order.paidCents,
    dueCents: order.dueCents,
  });

  if (debug) {
    return {
      status: "sent" as const,
      detail: {
        to: order.buyerEmail,
        subject,
        orderUrl,
        startsAt: order.startsAt,
        reminderDays: order.reminderDays,
        currency: order.currency,
        totalCents: order.totalCents,
        paidCents: order.paidCents,
        discountCents: order.discountCents,
        dueCents: order.dueCents,
        itemsCount: items.length,
      },
    };
  }

  await sendEmailOrThrow({
    to: order.buyerEmail,
    subject,
    html,
    tags: {
      kind: "reminder_v1",
      source: "send-reminder-mail",
      orderId: order.orderId,
      eventId: order.eventId,
    },
  });

  return {
    status: "sent" as const,
  };
}

async function runManual(input: {
  admin: any;
  appBaseUrl: string;
  orderId: string;
  debug: boolean;
  logger: any;
}) {
  const order = await loadOrderForReminderOrNull(
    input.admin,
    input.orderId,
    input.logger,
  );

  if (!order) {
    return {
      status: "invalid" as const,
      detail: "order_not_found",
    };
  }

  return await buildAndMaybeSendReminder({
    admin: input.admin,
    appBaseUrl: input.appBaseUrl,
    order,
    logger: input.logger,
    debug: input.debug,
  });
}

async function runCron(input: {
  admin: any;
  appBaseUrl: string;
  logger: any;
}) {
  const limit = 250;
  const horizonDays = 60;

  const now = new Date();
  const max = new Date(now);
  max.setUTCDate(max.getUTCDate() + horizonDays);

  const orders = await loadReminderCandidateOrders(
    input.admin,
    input.logger,
    limit,
  );

  const orgIds = Array.from(
    new Set(orders.map((order) => order.orgId).filter(Boolean)),
  );

  const reminderByOrgId = await loadReminderDaysByOrgId(
    input.admin,
    orgIds,
    input.logger,
  );

  let scanned = 0;
  let eligible = 0;
  let sent = 0;
  let skippedAlreadySent = 0;
  let skippedInvalid = 0;
  let skippedNoReminder = 0;

  for (const candidate of orders) {
    scanned++;

    if (!isCandidateValid(candidate)) {
      skippedInvalid++;
      continue;
    }

    const reminderDays = reminderByOrgId.get(candidate.orgId) ?? 0;

    if (reminderDays <= 0) {
      skippedNoReminder++;
      continue;
    }

    if (!isInsideCronHorizon(candidate.startsAt!, now, max)) continue;
    if (!shouldSendToday(candidate.startsAt!, reminderDays)) continue;

    eligible++;

    const discountCents = await loadOrderDiscountCents(
      input.admin,
      candidate.orderId,
      input.logger,
    );

    const dueCents = Math.max(
      0,
      candidate.totalCents - discountCents - candidate.paidCents,
    );

    const result = await buildAndMaybeSendReminder({
      admin: input.admin,
      appBaseUrl: input.appBaseUrl,
      logger: input.logger,
      order: {
        ...candidate,
        reminderDays,
        discountCents,
        dueCents,
      },
    });

    if (result.status === "sent") sent++;
    else if (result.status === "already_sent") skippedAlreadySent++;
    else skippedInvalid++;
  }

  return {
    scanned,
    eligible,
    sent,
    skippedAlreadySent,
    skippedNoReminder,
    skippedInvalid,
  };
}

Deno.serve(
  createEdgeHandler("send-reminder-mail", async (req, { logger }) => {
    const config = resolveRuntimeConfig();

    assertServiceTokenOrThrow(req, config.edgeServiceToken);

    const admin = createAdminClient(config);
    const payload = await parseSendReminderMailPayload(req);

    if (payload.kind === "manual") {
      const result = await runManual({
        admin,
        appBaseUrl: config.appBaseUrl,
        orderId: payload.data.orderId,
        debug: payload.data.debug,
        logger,
      });

      return json({
        ok: true,
        mode: "manual",
        ...result,
      });
    }

    const result = await runCron({
      admin,
      appBaseUrl: config.appBaseUrl,
      logger,
    });

    return json({
      ok: true,
      mode: "cron",
      ...result,
    });
  }),
);
