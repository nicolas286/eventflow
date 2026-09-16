import type { SupabaseClient } from "npm:@supabase/supabase-js@2.75.0";
import { internal, ResponseError } from "../_shared/errors.ts";
import type { CreateOrderIntentArgs } from "./registerTickets.contracts.ts";

function mapCreateOrderIntentError(message: unknown): ResponseError {
  const normalized = String(message ?? "");

  const mappings: ReadonlyArray<readonly [string, number, string]> = [
    ["EVENT_REGISTRATION_CLOSED", 409, "EVENT_REGISTRATION_CLOSED"],
    ["EVENT_SOLD_OUT", 409, "EVENT_SOLD_OUT"],
    ["MISSING_GATEKEEPER_PRODUCT", 400, "MISSING_GATEKEEPER_PRODUCT"],
    ["insufficient stock", 409, "SOLD_OUT"],
    ["attendees count mismatch", 400, "ATTENDEES_MISMATCH"],
    ["EVENT_NOT_PUBLISHED", 409, "EVENT_NOT_PUBLISHED"],
    ["EVENT_ENDED", 409, "EVENT_ENDED"],
    ["PROMO_CODE_INVALID", 400, "PROMO_CODE_INVALID"],
    ["PROMO_CODE_NOT_FOUND", 404, "PROMO_CODE_NOT_FOUND"],
    ["PROMO_CODE_INACTIVE", 409, "PROMO_CODE_INACTIVE"],
    ["PROMO_CODE_NOT_STARTED", 409, "PROMO_CODE_NOT_STARTED"],
    ["PROMO_CODE_EXPIRED", 409, "PROMO_CODE_EXPIRED"],
    ["PROMO_CODE_USAGE_LIMIT_REACHED", 409, "PROMO_CODE_USAGE_LIMIT_REACHED"],
    ["PROMO_CODE_NOT_APPLICABLE", 409, "PROMO_CODE_NOT_APPLICABLE"],
  ];

  const lowerCaseMessage = normalized.toLowerCase();
  const mapping = mappings.find(([needle]) =>
    lowerCaseMessage.includes(needle.toLowerCase())
  );
  if (mapping) return new ResponseError(mapping[1], mapping[2]);

  if (normalized.includes("PLAN_LIMIT")) {
    if (normalized.includes("registrations_per_event")) {
      return new ResponseError(403, "PLAN_LIMIT_REGISTRATIONS_PER_EVENT");
    }
    if (normalized.includes("paid_events_per_year")) {
      return new ResponseError(403, "PLAN_LIMIT_PAID_EVENTS_PER_YEAR");
    }
    return new ResponseError(403, "PLAN_LIMIT");
  }

  return new ResponseError(400, "FAILED");
}

export async function createOrderIntentOrThrow(opts: {
  admin: Pick<SupabaseClient, "rpc">;
  args: CreateOrderIntentArgs;
}) {
  const { data, error } = await opts.admin.rpc(
    "create_order_intent",
    opts.args,
  );

  if (error) {
    console.error("[register] create_order_intent failed", {
      code: error.code,
    });
    throw mapCreateOrderIntentError(error.message);
  }

  const orderId = data?.order_id;
  const bookingToken = data?.booking_token ?? null;
  const paymentRequired = Boolean(data?.payment_required);
  const totalCents = Number(data?.total_cents ?? 0);
  const discountCents = Number(data?.discount_cents ?? 0);
  const promoCodeId = data?.promo_code_id ?? null;
  const currency = data?.currency || "EUR";
  const dueNowCents = typeof data?.amount_due_now_cents === "number"
    ? Number(data.amount_due_now_cents)
    : Math.max(totalCents - discountCents, 0);

  if (!orderId) throw internal("ORDER_CREATION_FAILED");
  if (!bookingToken) throw internal("BOOKING_TOKEN_MISSING");
  if (paymentRequired && dueNowCents <= 0) {
    throw internal("INVALID_PAYMENT_AMOUNT");
  }

  return {
    orderId,
    bookingToken,
    paymentRequired,
    totalCents,
    discountCents,
    promoCodeId,
    dueNowCents,
    currency,
  };
}
