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
) {
  if (!eventId) {
    return {
      eventTitle: "Votre événement",
      startsAt: null,
      location: null,
      description: null,
    };
  }

  const { data } = await admin
    .from("events")
    .select("title, description, starts_at, location")
    .eq("id", eventId)
    .maybeSingle();

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

export async function claimEmailOnceOrThrow(admin: SupabaseClient, opts: {
  orderId: string;
  kind: string;
  logger: EdgeLogger;
}) {
  const { data: canSend, error } = await admin.rpc("log_email_once", {
    p_order_id: opts.orderId,
    p_kind: opts.kind,
  });

  if (error) {
    opts.logger.error("log_email_once_failed", {
      orderId: opts.orderId,
      kind: opts.kind,
      error,
    });

    throw badGateway("LOG_FAILED");
  }

  return Boolean(canSend);
}
