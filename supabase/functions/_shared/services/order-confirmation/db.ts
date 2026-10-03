import type { SupabaseClient } from "@supabase/supabase-js";
import { badRequest, internal, notFound } from "../../errors.ts";

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
