import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../../modules/logger/mod.ts";
import { badGateway, badRequest, internal, notFound } from "../../errors.ts";

export async function loadOrderForConfirmationOrThrow(
  admin: SupabaseClient,
  orderId: string,
) {
  const { data, error } = await admin
    .from("orders")
    .select(
      "id, event_id, currency, total_cents, paid_cents, buyer_email, booking_token",
    )
    .eq("id", orderId)
    .maybeSingle();

  if (error || !data?.id) {
    throw notFound("ORDER_NOT_FOUND");
  }

  const to = String(data.buyer_email ?? "").trim();

  if (!to) {
    throw badRequest("ORDER_BUYER_EMAIL_INVALID");
  }

  const bookingToken = String(data.booking_token ?? "").trim();

  if (!bookingToken) {
    throw internal("ORDER_BOOKING_TOKEN_MISSING");
  }

  return {
    id: data.id,
    eventId: data.event_id ? String(data.event_id) : null,
    to,
    bookingToken,
    currency: String(data.currency ?? "EUR").trim() || "EUR",
    totalCents: Number(data.total_cents ?? 0) || 0,
    paidCents: Number(data.paid_cents ?? 0) || 0,
  };
}

export async function loadEventForConfirmation(
  admin: SupabaseClient,
  eventId: string | null,
  logger: EdgeLogger,
) {
  if (!eventId) {
    return {
      eventTitle: "Votre événement",
      startsAt: null,
      location: null,
      description: null,
    };
  }

  const { data, error } = await admin
    .from("events")
    .select("title, description, starts_at, location")
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    logger.error("event_load_failed", {
      eventId,
      error,
    });
  }

  return {
    eventTitle: data?.title ? String(data.title) : "Votre événement",
    startsAt: data?.starts_at ? String(data.starts_at) : null,
    location: data?.location ? String(data.location) : null,
    description: data?.description ? String(data.description) : null,
  };
}

export async function loadOrderItemsForConfirmation(
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
    logger.error("order_items_load_failed", {
      orderId,
      error,
    });
  }

  return (rows ?? [])
    .map((r) => {
      const name = String(r?.product_name_snapshot ?? "").trim() || "Billet";
      const qty = Number(r?.quantity ?? 0);
      const unitCents = Number(r?.unit_price_cents_snapshot ?? 0);

      if (!Number.isFinite(qty) || qty <= 0) return null;
      if (!Number.isFinite(unitCents) || unitCents < 0) return null;

      return {
        name,
        qty,
        unitCents,
        lineCents: unitCents * qty,
      };
    })
    .filter((item) => item !== null);
}

export async function loadPromoCodeRedemptionRows(
  admin: SupabaseClient,
  orderId: string,
  logger: EdgeLogger,
) {
  const { data: rows, error } = await admin
    .from("promo_code_redemptions")
    .select("discount_cents")
    .eq("order_id", orderId);

  if (error) {
    logger.error("promo_code_redemption_loading_failed", {
      orderId,
      error,
    });
  }

  return (rows ?? []);
}

export async function loadTicketsForConfirmation(
  admin: SupabaseClient,
  orderId: string,
  logger: EdgeLogger,
) {
  const { data: tickets, error } = await admin
    .from("tickets")
    .select(
      "id, ticket_index, qr_token, admits_count, status, order_item_id, product_id",
    )
    .eq("order_id", orderId)
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    logger.error("tickets_loading_failed", {
      orderId,
      error,
    });

    throw badGateway("TICKETS_LOADING_FAILED");
  }

  return tickets ?? [];
}

function compactAnswerValue(value: unknown): string | null {
  if (value == null) return null;

  if (typeof value === "string") {
    const t = value.trim();
    return t || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((x) => compactAnswerValue(x))
      .filter(Boolean);

    return parts.length ? parts.join(", ") : null;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;

    if ("label" in record) return compactAnswerValue(record.label);
    if ("value" in record) return compactAnswerValue(record.value);

    return JSON.stringify(value);
  }

  return String(value).trim() || null;
}

export async function loadTicketProductMetaById(
  admin: SupabaseClient,
  productIds: string[],
  orderItemIds: string[],
  logger: EdgeLogger,
) {
  const productMetaById = new Map<
    string,
    {
      createsAttendees: boolean;
    }
  >();

  const orderItemMetaById = new Map<
    string,
    {
      productNameSnapshot: string;
      unitPriceCents: number;
    }
  >();

  if (productIds.length > 0) {
    const { data, error } = await admin
      .from("event_products")
      .select("id, creates_attendees")
      .in("id", productIds);

    if (error) {
      logger.error("event_products_load_failed", {
        productIds,
        error,
      });
    }

    for (const row of data ?? []) {
      productMetaById.set(String(row.id), {
        createsAttendees: Boolean(row.creates_attendees),
      });
    }
  }

  if (orderItemIds.length > 0) {
    const { data, error } = await admin
      .from("order_items")
      .select("id, product_name_snapshot, unit_price_cents_snapshot")
      .in("id", orderItemIds);

    if (error) {
      logger.error("order_items_ticket_meta_load_failed", {
        orderItemIds,
        error,
      });
    }

    for (const row of data ?? []) {
      orderItemMetaById.set(String(row.id), {
        productNameSnapshot: String(row.product_name_snapshot ?? "").trim() ||
          "Billet",
        unitPriceCents: Number(row.unit_price_cents_snapshot ?? 0) || 0,
      });
    }
  }

  return {
    productMetaById,
    orderItemMetaById,
  };
}

export async function loadAttendeesForConfirmation(
  admin: SupabaseClient,
  orderId: string,
  logger: EdgeLogger,
) {
  const { data, error } = await admin
    .from("order_attendees")
    .select("id, product_id, attendee_index")
    .eq("order_id", orderId)
    .order("attendee_index", {
      ascending: true,
    });

  if (error) {
    logger.error("order_attendees_load_failed", {
      orderId,
      error,
    });
  }

  return data ?? [];
}

export async function loadAnswersByAttendeeIdForConfirmation(
  admin: SupabaseClient,
  attendeeIds: string[],
  logger: EdgeLogger,
) {
  const answersByAttendeeId = new Map<
    string,
    Array<{
      key: string;
      label: string;
      value: string;
    }>
  >();

  if (attendeeIds.length === 0) {
    return answersByAttendeeId;
  }

  const { data, error } = await admin
    .from("order_attendee_answers")
    .select(
      "attendee_id, field_label_snapshot, field_key_snapshot, value, created_at",
    )
    .in("attendee_id", attendeeIds)
    .order("created_at", {
      ascending: true,
    });

  if (error) {
    logger.error("order_attendee_answers_load_failed", {
      attendeeIds,
      error,
    });

    return answersByAttendeeId;
  }

  for (const row of data ?? []) {
    const attendeeId = String(row.attendee_id);
    const key = String(row.field_key_snapshot ?? "").trim();
    const label = String(row.field_label_snapshot ?? "").trim() || key ||
      "Champ";
    const value = compactAnswerValue(row.value);

    if (!value) continue;

    const arr = answersByAttendeeId.get(attendeeId) ?? [];

    arr.push({
      key,
      label,
      value,
    });

    answersByAttendeeId.set(attendeeId, arr);
  }

  return answersByAttendeeId;
}

export function buildPdfTickets(input: {
  ticketRows: Array<Record<string, unknown>>;
  attendeeRows: Array<Record<string, unknown>>;
  answersByAttendeeId: Map<
    string,
    Array<{
      key: string;
      label: string;
      value: string;
    }>
  >;
  productMetaById: {
    productMetaById: Map<string, { createsAttendees: boolean }>;
    orderItemMetaById: Map<
      string,
      {
        productNameSnapshot: string;
        unitPriceCents: number;
      }
    >;
  };
}) {
  const {
    ticketRows,
    attendeeRows,
    answersByAttendeeId,
    productMetaById,
  } = input;

  const attendeeIdsByProductId = new Map<string, string[]>();

  for (const row of attendeeRows ?? []) {
    const productId = String(row.product_id);
    const attendeeId = String(row.id);

    const arr = attendeeIdsByProductId.get(productId) ?? [];
    arr.push(attendeeId);
    attendeeIdsByProductId.set(productId, arr);
  }

  const rawTickets = ticketRows.map((row) => {
    const orderItemId = String(row.order_item_id);
    const productId = String(row.product_id);

    const orderItemMeta = productMetaById.orderItemMetaById.get(orderItemId);
    const productMeta = productMetaById.productMetaById.get(productId);

    const createsAttendees = productMeta?.createsAttendees ?? false;
    const admitsCount = Math.max(1, Number(row.admits_count ?? 1) || 1);
    const ticketIndex = Number(row.ticket_index ?? 0) || 0;

    let attendee_summary_lines: string[] = [];

    if (createsAttendees) {
      const attendeeIdsForProduct = attendeeIdsByProductId.get(productId) ?? [];

      const start = Math.max(0, (ticketIndex - 1) * admitsCount);
      const end = start + admitsCount;

      const slice = attendeeIdsForProduct.slice(start, end);

      attendee_summary_lines = slice
        .flatMap((attendeeId) => {
          const answers = answersByAttendeeId.get(attendeeId) ?? [];

          const prioritized = [
            ...answers.filter((answer) => answer.key === "first_name"),
            ...answers.filter((answer) => answer.key === "last_name"),
            ...answers.filter((answer) => answer.key === "email"),
            ...answers.filter(
              (answer) =>
                !["first_name", "last_name", "email"].includes(answer.key),
            ),
          ];

          return prioritized
            .slice(0, 2)
            .map((answer) => `${answer.label} : ${answer.value}`);
        })
        .slice(0, 2);
    }

    return {
      id: String(row.id),
      ticket_index: ticketIndex,
      qr_token: String(row.qr_token ?? ""),
      admits_count: admitsCount,
      status: String(row.status ?? "valid"),
      product_id: productId,
      order_item_id: orderItemId,
      product_name_snapshot: orderItemMeta?.productNameSnapshot ?? "Billet",
      unit_price_cents: orderItemMeta?.unitPriceCents ?? 0,
      creates_attendees: createsAttendees,
      attendee_summary_lines,
    };
  });

  return rawTickets.sort((a, b) => {
    if (a.creates_attendees !== b.creates_attendees) {
      return a.creates_attendees ? -1 : 1;
    }

    return a.ticket_index - b.ticket_index;
  });
}
