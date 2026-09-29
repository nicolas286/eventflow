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
  }));
});
