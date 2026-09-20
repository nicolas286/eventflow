import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { orderIdSchema, bookingTokenSchema, orderPublicSchema } from "../../../shared/schemas/orders-read.ts";

export const handleReadOrderRequest = createEdgeHandler({
  name: "orders-read", method: "GET", auth: "none", serviceClient: true,
}, async ({ req, serviceClient: admin }) => {
  const url = new URL(req.url);
  const orderId = url.pathname.split("/").filter(Boolean).at(-1);
  const token = url.searchParams.get("token") ?? url.searchParams.get("bookingToken");
  if (!orderIdSchema.safeParse(orderId).success) return json(req, { error: "INVALID_ORDER_ID" }, 400);
  const bookingToken = bookingTokenSchema.safeParse(token);
  if (!bookingToken.success) return json(req, { error: "MISSING_TOKEN" }, 401);
  const { data: order, error } = await admin.from("orders")
    .select("id, status, total_cents, currency").eq("id", orderId)
    .eq("booking_token", bookingToken.data).maybeSingle();
  if (error) return json(req, { error: "DB_ERROR", details: error.message }, 500);
  if (!order) return json(req, { error: "NOT_FOUND" }, 404);
  const { data: payment } = await admin.from("payments").select("status")
    .eq("order_id", orderId).eq("provider", "mollie")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  return json(req, orderPublicSchema.parse({
    id: order.id, status: order.status, totalCents: order.total_cents ?? null,
    currency: order.currency ?? null, paymentStatus: payment?.status ?? null,
  }));
});
