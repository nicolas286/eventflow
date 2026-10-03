import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { resolveRequestClientIp } from "../_shared/app/client-ip.ts";
import { json } from "../_shared/app/http.ts";
import { orderIdSchema, bookingTokenSchema, orderPublicSchema } from "../../../shared/schemas/orders-read.ts";

export const handleReadOrderRequest = createEdgeHandler({
  name: "orders-read", method: "GET", auth: "none", serviceClient: true,
}, async ({ req, serviceClient: admin, logger }) => {
  const clientIp = await resolveRequestClientIp(req);
  const ingress = await consumeRequestRateLimit({
    req, supabase: admin, logger,
    key: clientIp ? `ip:${clientIp.ip}` : "shared:unresolved",
    ...(clientIp ? applicationRateLimits.orderReadIp : applicationRateLimits.orderReadFallback),
  });
  if (!ingress.allowed) return ingress.response;
  const url = new URL(req.url);
  const orderId = url.pathname.split("/").filter(Boolean).at(-1);
  const token = url.searchParams.get("token") ?? url.searchParams.get("bookingToken");
  if (!orderIdSchema.safeParse(orderId).success) return json(req, { error: "INVALID_ORDER_ID" }, 400);
  const bookingToken = bookingTokenSchema.safeParse(token);
  if (!bookingToken.success) return json(req, { error: "MISSING_TOKEN" }, 401);
  const { data: order, error } = await admin.from("orders")
    .select("id, status, total_cents, currency, event_id, org_id, buyer_email").eq("id", orderId)
    .eq("booking_token", bookingToken.data).maybeSingle();
  // The filter contains a capability; never return/log a database error that
  // could include its value or the request URL.
  if (error) return json(req, { error: "DB_ERROR" }, 500);
  if (!order) return json(req, { error: "NOT_FOUND" }, 404);
  const resourceQuota = await consumeRequestRateLimit({
    req, supabase: admin, logger, key: `order:${order.id}`,
    ...applicationRateLimits.orderReadResource,
  });
  if (!resourceQuota.allowed) return resourceQuota.response;
  const [{ data: event }, { data: organization }, { data: itemRows }] = await Promise.all([
    order.event_id
      ? admin.from("events").select("slug").eq("id", order.event_id).maybeSingle()
      : Promise.resolve({ data: null }),
    order.org_id
      ? admin.from("organizations").select("slug").eq("id", order.org_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("order_items")
      .select("product_name_snapshot, unit_price_cents_snapshot, quantity")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
  ]);
  const items = (Array.isArray(itemRows) ? itemRows : []).flatMap((row) => {
    const quantity = Number(row.quantity ?? 0);
    const unitPriceCents = Number(row.unit_price_cents_snapshot ?? 0);
    if (!Number.isInteger(quantity) || quantity <= 0) return [];
    if (!Number.isInteger(unitPriceCents) || unitPriceCents < 0) return [];
    return [{
      name: String(row.product_name_snapshot ?? "").trim() || "Billet",
      quantity,
      unitPriceCents,
      totalCents: unitPriceCents * quantity,
      currency: String(order.currency ?? "EUR"),
    }];
  });
  const { data: payment } = await admin.from("payments")
    .select("provider, provider_payment_id, status, amount_cents, currency, raw")
    .eq("order_id", orderId).eq("is_refund", false)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const paymentMethod = payment?.provider === "stripe"
    ? "stripe"
    : payment?.provider === "offline" &&
        String(payment.provider_payment_id ?? "").startsWith("bank_transfer:")
    ? "bank_transfer"
    : null;
  let bankTransfer = null;
  if (paymentMethod === "bank_transfer" && order.status === "awaiting_payment") {
    const { data: stored } = await admin.rpc("get_bank_transfer_instructions", {
      p_order_id: orderId,
    });
    const raw = payment?.raw && typeof payment.raw === "object"
      ? payment.raw as Record<string, unknown>
      : {};

    if (stored?.iban || raw.iban) {
      bankTransfer = {
        internalReference: String(stored?.internalReference ?? order.id),
        communication: String(stored?.communication ?? raw.communication ?? ""),
        beneficiary: String(stored?.beneficiary ?? raw.beneficiary ?? ""),
        iban: String(stored?.iban ?? raw.iban ?? ""),
        amountCents: Number(stored?.amountCents ?? payment?.amount_cents ?? 0),
        currency: String(stored?.currency ?? payment?.currency ?? order.currency ?? "EUR"),
        paymentDueAt: null,
      };
    }
  }
  return json(req, orderPublicSchema.parse({
    id: order.id, status: order.status, totalCents: order.total_cents ?? null,
    currency: order.currency ?? null, paymentStatus: payment?.status ?? null,
    paymentMethod,
    bankTransfer,
    orgSlug: organization?.slug ?? null,
    eventSlug: event?.slug ?? null,
    buyerEmail: order.buyer_email ?? null,
    items,
  }));
});
