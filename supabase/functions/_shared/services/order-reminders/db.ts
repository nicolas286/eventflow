import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../../modules/logger/mod.ts";
import { badGateway } from "../../errors.ts";

export type ReminderOrderItem = {
  name: string;
  qty: number;
  unitCents: number;
  lineCents: number;
};

export type ReminderCandidateOrder = {
  orderId: string;
  buyerEmail: string;
  bookingToken: string;
  eventId: string;
  orgId: string;
  eventTitle: string;
  startsAt: string | null;
  location: string | null;
  description: string | null;
  currency: string;
  totalCents: number;
  paidCents: number;
};

export type ReminderOrderContext = ReminderCandidateOrder & {
  reminderDays: number;
  discountCents: number;
  dueCents: number;
};

export type ReminderSendStatus =
  | "sent"
  | "already_sent"
  | "invalid";

function compactString(value: unknown): string {
  return String(value ?? "").trim();
}

export function looksLikeEmail(value: unknown) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(compactString(value));
}

export async function loadReminderCandidateOrders(
  admin: SupabaseClient,
  logger: EdgeLogger,
  limit = 250,
) {
  const { data: orders, error } = await admin
    .from("orders")
    .select(`
      id,
      buyer_email,
      booking_token,
      status,
      event_id,
      currency,
      total_cents,
      paid_cents,
      events:events (
        id,
        org_id,
        title,
        description,
        starts_at,
        location
      )
    `)
    .in("status", ["created", "pending", "paid", "confirmed"])
    .not("event_id", "is", null)
    .limit(limit);

  if (error) {
    logger.error("reminder_orders_load_failed", { error });
    throw badGateway("REMINDER_ORDERS_LOAD_FAILED");
  }

  return (orders ?? []).map((order) => {
    const rawEvent: unknown = order?.events;
    const event =
      rawEvent && typeof rawEvent === "object" && !Array.isArray(rawEvent)
        ? rawEvent as Record<string, unknown>
        : null;

    return {
      orderId: compactString(order?.id),
      buyerEmail: compactString(order?.buyer_email),
      bookingToken: compactString(order?.booking_token),
      eventId: compactString(order?.event_id),
      orgId: compactString(event?.org_id),
      eventTitle: compactString(event?.title) || "Votre événement",
      startsAt: event?.starts_at ? String(event.starts_at) : null,
      location: event?.location ? String(event.location) : null,
      description: event?.description ? String(event.description) : null,
      currency: compactString(order?.currency) || "EUR",
      totalCents: Number(order?.total_cents ?? 0) || 0,
      paidCents: Number(order?.paid_cents ?? 0) || 0,
    } satisfies ReminderCandidateOrder;
  });
}

export async function loadReminderDaysByOrgId(
  admin: SupabaseClient,
  orgIds: string[],
  logger: EdgeLogger,
) {
  const reminderByOrgId = new Map<string, number>();

  if (orgIds.length === 0) return reminderByOrgId;

  const { data, error } = await admin
    .from("organization_profile")
    .select("org_id, email_reminder_days_before")
    .in("org_id", orgIds);

  if (error) {
    logger.error("organization_profile_reminder_load_failed", {
      orgIds,
      error,
    });

    throw badGateway("ORGANIZATION_PROFILE_REMINDER_LOAD_FAILED");
  }

  for (const row of data ?? []) {
    reminderByOrgId.set(
      String(row.org_id),
      Number(row.email_reminder_days_before ?? 0) || 0,
    );
  }

  return reminderByOrgId;
}

export async function loadOrderForReminderOrNull(
  admin: SupabaseClient,
  orderId: string,
  logger: EdgeLogger,
) {
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id, event_id, buyer_email, booking_token, currency, total_cents, paid_cents",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    logger.error("reminder_order_load_failed", { orderId, error });
    return null;
  }

  if (!order?.id) return null;

  let event = null;

  if (order.event_id) {
    const { data, error: eventError } = await admin
      .from("events")
      .select("id, org_id, title, description, starts_at, location")
      .eq("id", String(order.event_id))
      .maybeSingle();

    if (eventError) {
      logger.error("reminder_event_load_failed", {
        orderId,
        eventId: order.event_id,
        error: eventError,
      });
    }

    event = data;
  }

  const orgId = compactString(event?.org_id);
  let reminderDays = 0;

  if (orgId) {
    const byOrg = await loadReminderDaysByOrgId(admin, [orgId], logger);
    reminderDays = byOrg.get(orgId) ?? 0;
  }

  const discountCents = await loadOrderDiscountCents(admin, orderId, logger);
  const totalCents = Number(order.total_cents ?? 0) || 0;
  const paidCents = Number(order.paid_cents ?? 0) || 0;

  return {
    orderId: String(order.id),
    buyerEmail: compactString(order.buyer_email),
    bookingToken: compactString(order.booking_token),
    eventId: compactString(order.event_id),
    orgId,
    eventTitle: compactString(event?.title) || "Votre événement",
    startsAt: event?.starts_at ? String(event.starts_at) : null,
    location: event?.location ? String(event.location) : null,
    description: event?.description ? String(event.description) : null,
    reminderDays,
    currency: compactString(order.currency) || "EUR",
    totalCents,
    discountCents,
    paidCents,
    dueCents: Math.max(0, totalCents - discountCents - paidCents),
  } satisfies ReminderOrderContext;
}

export async function loadOrderItemsForReminder(
  admin: SupabaseClient,
  orderId: string,
  logger: EdgeLogger,
) {
  const { data: rows, error } = await admin
    .from("order_items")
    .select("product_name_snapshot, unit_price_cents_snapshot, quantity")
    .eq("order_id", orderId)
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    logger.error("reminder_order_items_load_failed", { orderId, error });
    return [] as ReminderOrderItem[];
  }

  return (rows ?? [])
    .map((row) => {
      const name = compactString(row?.product_name_snapshot) || "Billet";
      const qty = Number(row?.quantity ?? 0);
      const unitCents = Number(row?.unit_price_cents_snapshot ?? 0);

      if (!Number.isFinite(qty) || qty <= 0) return null;
      if (!Number.isFinite(unitCents) || unitCents < 0) return null;

      return {
        name,
        qty,
        unitCents,
        lineCents: unitCents * qty,
      } satisfies ReminderOrderItem;
    })
    .filter(Boolean) as ReminderOrderItem[];
}

export async function loadOrderDiscountCents(
  admin: SupabaseClient,
  orderId: string,
  logger: EdgeLogger,
) {
  const { data, error } = await admin
    .from("promo_code_redemptions")
    .select("discount_cents")
    .eq("order_id", orderId);

  if (error) {
    logger.error("reminder_promo_code_redemptions_load_failed", {
      orderId,
      error,
    });

    return 0;
  }

  return (data ?? []).reduce((sum, row) => {
    const n = Number(row?.discount_cents ?? 0);
    return sum + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

export async function logReminderEmailOnce(
  admin: SupabaseClient,
  orderId: string,
  logger: EdgeLogger,
) {
  const { data: logged, error } = await admin.rpc("log_email_once", {
    p_order_id: orderId,
    p_kind: "reminder_v1",
  });

  if (error) {
    logger.error("reminder_email_log_once_failed", {
      orderId,
      error,
    });

    return false;
  }

  return Boolean(logged);
}
