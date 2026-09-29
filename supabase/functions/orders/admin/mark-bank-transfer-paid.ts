import { markBankTransferPaidResponseSchema } from "../../../../shared/schemas/orders-admin.ts";
import { orderIdSchema } from "../../../../shared/schemas/orders-read.ts";
import { getBearer } from "../../_shared/auth.ts";
import { createEdgeHandler } from "../../_shared/app/edge-handler/mod.ts";
import { json as baseJson } from "../../_shared/app/http.ts";
import {
  badRequest,
  conflict,
  forbidden,
  internal,
  notFound,
  ResponseError,
} from "../../_shared/errors.ts";
import { serializeError } from "../../_shared/modules/logger/mod.ts";
import { sendConfirmationEmailForOrderSafe } from "../public/emails.ts";
import { bankTransferPaymentId } from "../public/bank-transfer.ts";

function json(req: Request, data: unknown, status = 200) {
  if (status < 400) markBankTransferPaidResponseSchema.parse(data);
  return baseJson(req, data, status);
}

function hasBankTransferMethod(raw: unknown) {
  return Boolean(
    raw &&
      typeof raw === "object" &&
      (raw as { method?: unknown }).method === "bank_transfer",
  );
}

export const handleMarkBankTransferPaidRequest = createEdgeHandler(
  {
    name: "orders-admin-mark-bank-transfer-paid",
    method: "POST",
    auth: "required",
    serviceClient: true,
    authenticationRequiredResponse: (req) =>
      baseJson(
        req,
        { error: getBearer(req) ? "INVALID_SESSION" : "NOT_AUTHENTICATED" },
        401,
      ),
    onError: ({ req, logger, error }) => {
      if (error instanceof ResponseError) {
        logger.warn("response_error", {
          code: error.code,
          status: error.status,
        });
        return baseJson(req, { error: error.code }, error.status);
      }
      logger.error("unexpected_error", { error: serializeError(error) });
      return baseJson(req, { error: "UNEXPECTED_ERROR" }, 500);
    },
  },
  async ({ req, logger, serviceClient: admin, user }) => {
    const segments = new URL(req.url).pathname.split("/").filter(Boolean);
    const parsedOrderId = orderIdSchema.safeParse(segments.at(-2) ?? "");
    if (!parsedOrderId.success) throw badRequest("INVALID_ORDER_ID");
    const orderId = parsedOrderId.data;

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id, org_id, status, total_cents, paid_cents, currency")
      .eq("id", orderId)
      .maybeSingle();
    if (orderError) throw internal("ORDER_LOAD_FAILED");
    if (!order?.id) throw notFound("ORDER_NOT_FOUND");

    const { data: membership, error: membershipError } = await admin
      .from("organization_members")
      .select("role")
      .eq("org_id", order.org_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (membershipError) throw internal("MEMBERSHIP_LOAD_FAILED");
    if (!membership || !["owner", "admin"].includes(membership.role)) {
      throw forbidden("FORBIDDEN");
    }

    if (["cancelled", "canceled", "expired"].includes(order.status)) {
      throw conflict("ORDER_NOT_PAYABLE");
    }

    const providerPaymentId = bankTransferPaymentId(order.id);
    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .select("amount_cents, currency, status, raw")
      .eq("order_id", order.id)
      .eq("provider", "offline")
      .eq("provider_payment_id", providerPaymentId)
      .eq("type", "payment")
      .maybeSingle();
    if (paymentError) throw internal("BANK_TRANSFER_PAYMENT_LOAD_FAILED");
    if (!payment || !hasBankTransferMethod(payment.raw)) {
      throw conflict("ORDER_IS_NOT_A_BANK_TRANSFER");
    }

    const { data: applied, error: applyError } = await admin.rpc(
      "apply_order_payment",
      {
        p_order_id: order.id,
        p_provider: "offline",
        p_amount_cents: payment.amount_cents,
        p_currency: payment.currency,
        p_provider_payment_id: providerPaymentId,
        p_raw: payment.raw,
        p_note: `bank_transfer_confirmed_by=${user.id}`,
      },
    );
    if (applyError) {
      logger.error("apply_order_payment_failed", {
        orderId,
        error: applyError,
      });
      throw conflict("BANK_TRANSFER_PAYMENT_APPLY_FAILED");
    }

    const { error: ticketError } = await admin.rpc("issue_order_tickets", {
      p_order_id: order.id,
    });
    if (ticketError) {
      logger.error("issue_order_tickets_failed", {
        orderId,
        error: ticketError,
      });
      throw internal("ISSUE_ORDER_TICKETS_FAILED");
    }

    await sendConfirmationEmailForOrderSafe({
      admin,
      orderId: order.id,
      functionsBase: Deno.env.get("FUNCTIONS_URL") ?? "",
      edgeServiceToken: Deno.env.get("EDGE_SERVICE_TOKEN") ?? null,
      logger,
    });

    return json(req, {
      ok: true,
      orderId: order.id,
      status: applied.status,
      paidCents: applied.paid_cents,
      totalCents: applied.total_cents,
      idempotent: Boolean(applied.idempotent),
    });
  },
);
