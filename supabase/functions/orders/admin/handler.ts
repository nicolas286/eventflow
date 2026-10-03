import {
  adminAppliedPaymentSchema,
  adminRegisterSuccessSchema,
} from "./adminRegister.contracts.ts";
import crypto from "node:crypto";
import { json as baseJson } from "../../_shared/app/http.ts";
import { serializeError } from "../../_shared/logger.ts";
import { getBearer } from "../../_shared/auth.ts";
import { createEdgeHandler } from "../../_shared/app/edge-handler/mod.ts";
import { applicationRateLimits } from "../../_shared/app/config/rate-limits.ts";
import { consumeRequestRateLimit } from "../../_shared/app/rate-limit/mod.ts";
import { parseAdminRegisterPayload } from "./validation.ts";
import { ResponseError } from "../../_shared/errors.ts";
import { type AdminRegisterPayload } from "./adminRegister.contracts.ts";
import { assertPlatformRegistrationsOpen } from "../platform-registration.ts";
import { assertOrganizationManager } from "../../_shared/organization-access.ts";
import { assertOrganizationRegistrationsAllowed } from "../organization-registration.ts";

function json(req: Request, data: unknown, status = 200) {
  if (status < 400) adminRegisterSuccessSchema.parse(data);
  return baseJson(req, data, status);
}

function buildBuyer(body: AdminRegisterPayload) {
  const buyer = body.buyer ?? {};

  return {
    email: buyer.email ?? body.buyerEmail ?? null,
    name: buyer.name ?? null,
    phone: buyer.phone ?? null,
    is_attendee: typeof buyer.isAttendee === "boolean"
      ? buyer.isAttendee
      : false,
  };
}

export const handleAdminOrderRequest = createEdgeHandler(
  {
    name: "orders-admin",
    method: "POST",
    auth: "required",
    serviceClient: true,
    authenticationRequiredResponse: (req) =>
      json(req, {
        error: getBearer(req) ? "INVALID_SESSION" : "NOT_AUTHENTICATED",
      }, 401),
  },
  async ({ req, logger, serviceClient: admin, user }) => {
    try {
      await assertPlatformRegistrationsOpen(admin);

      const body = await parseAdminRegisterPayload(req, logger);
      const { data: ev, error: evErr } = await admin.from("events").select(
        "id, org_id",
      ).eq("id", body.eventId).maybeSingle();

      if (evErr || !ev) {
        logger.warn("event_not_found");
        return json(req, {
          error: "EVENT_NOT_FOUND",
        }, 404);
      }

      await assertOrganizationManager(admin, ev.org_id, user.id);
      await assertOrganizationRegistrationsAllowed(admin, ev.org_id);

      const quota = await consumeRequestRateLimit({
        req,
        supabase: admin,
        logger,
        key: `user:${user.id}:org:${ev.org_id}`,
        ...applicationRateLimits.adminOrderCreate,
      });
      if (!quota.allowed) return quota.response;

      const itemProductIds = body.items.map((x) => x.eventProductId);

      const { data: products, error: prodErr } = await admin.from(
        "event_products",
      ).select("id, event_id").in("id", itemProductIds);

      if (prodErr) {
        logger.warn("product_check_failed");
        return json(req, {
          error: "PRODUCT_CHECK_FAILED",
          details: {
            message: prodErr.message,
          },
        }, 500);
      }

      if (!products || products.length !== itemProductIds.length) {
        logger.warn("unknown_event_product_in_items");
        return json(req, {
          error: "UNKNOWN_EVENT_PRODUCT_IN_ITEMS",
        }, 400);
      }

      const bad = products.find((p) => p.event_id !== body.eventId);

      if (bad) {
        logger.warn("product_does_not_belong_to_this_event");
        return json(req, {
          error: "PRODUCT_EVENT_MISMATCH",
          details: {
            eventProductId: bad.id,
          },
        }, 400);
      }

      const p_items = body.items.map((it) => ({
        event_product_id: it.eventProductId,
        quantity: it.quantity,
      }));

      const p_attendees = body.attendees.map((a) => ({
        event_product_id: a.eventProductId,
        first_name: null,
        last_name: null,
        email: null,
        phone: null,
        answers: (a.answers ?? []).map((x) => ({
          event_form_field_id: x.eventFormFieldId,
          value: x.value ?? null,
        })),
      }));

      const p_buyer = buildBuyer(body);

      const { data: rpcRes, error: rpcErr } = await admin.rpc(
        "create_order_intent",
        {
          p_event_id: body.eventId,
          p_items,
          p_attendees,
          p_buyer,
          p_rate_key: null,
        },
      );

      if (rpcErr) {
        if (rpcErr.message === "ORGANIZATION_SUSPENDED") {
          return json(req, { error: "ORGANIZATION_SUSPENDED" }, 403);
        }
        logger.warn("rpc_create_order_intent_failed");
        return json(req, {
          error: "RPC_CREATE_ORDER_INTENT_FAILED",
          details: {
            message: rpcErr.message,
          },
        }, 400);
      }

      const orderId = rpcRes?.order_id;
      const totalCents = rpcRes?.total_cents;
      const dueNowCentsRaw = rpcRes?.amount_due_now_cents;
      const currency = rpcRes?.currency;
      const paymentRequired = Boolean(rpcRes?.payment_required);

      if (!orderId || typeof totalCents !== "number" || !currency) {
        logger.warn("order_creation_failed");
        return json(req, {
          error: "ORDER_CREATION_FAILED",
          details: {
            reason: "unexpected_rpc_result",
          },
        }, 500);
      }

      const baseStatus = rpcRes?.status ??
        (paymentRequired ? "awaiting_payment" : "paid");

      if (body.markPaid) {
        const mode = body.payMode ?? "deposit";
        let amountCents;

        if (mode === "deposit") {
          amountCents = typeof dueNowCentsRaw === "number"
            ? dueNowCentsRaw
            : totalCents;
        } else if (mode === "full") {
          amountCents = totalCents;
        } else {
          amountCents = body.customAmountCents ?? 0;
        }

        if (amountCents > totalCents) {
          logger.warn("payment_amount_cannot_exceed_total");
          return json(req, {
            error: "PAYMENT_AMOUNT_EXCEEDS_TOTAL",
            details: { amountCents, totalCents },
          }, 400);
        }

        if (!paymentRequired || totalCents === 0) {
          logger.info("completed", {
            orderId,
            status: "paid",
            markPaid: Boolean(body.markPaid),
          });

          return json(req, {
            ok: true,
            orderId,
            currency: String(currency).toUpperCase(),
            totalCents,
            status: "paid",
            amountAppliedCents: 0,
            dueNowCents: 0,
            bookingToken: null,
            expiresAt: null,
            payment: null,
          });
        }

        if (amountCents <= 0) {
          logger.warn("invalid_payment_amount");
          return json(req, { error: "INVALID_PAYMENT_AMOUNT" }, 400);
        }

        const parsedDue = adminRegisterSuccessSchema.shape.dueNowCents
          .safeParse(
            dueNowCentsRaw,
          );
        if (
          !parsedDue.success || parsedDue.data === null ||
          parsedDue.data > totalCents
        ) {
          logger.warn("order_payment_requirement_invalid");
          return json(req, { error: "ORDER_PAYMENT_REQUIREMENT_INVALID" }, 500);
        }

        const offlineRef = `offline:${crypto.randomUUID()}`;

        const metaNote = [
          body.paymentMethod ? `method=${body.paymentMethod}` : null,
          body.note ? `note=${body.note}` : null,
          `by=${user.id}`,
        ].filter(Boolean).join(" | ");

        const { data: payRes, error: payErr } = await admin.rpc(
          "apply_order_payment",
          {
            p_order_id: orderId,
            p_provider: "offline",
            p_amount_cents: amountCents,
            p_currency: String(currency).toUpperCase(),
            p_provider_payment_id: offlineRef,
            p_raw: null,
            p_note: metaNote || null,
          },
        );

        if (payErr) {
          logger.warn("apply_order_payment_failed");
          return json(req, {
            error: "APPLY_ORDER_PAYMENT_FAILED",
            details: {
              message: payErr.message,
            },
          }, 400);
        }

        const parsedPayment = adminAppliedPaymentSchema.safeParse(payRes);
        if (
          !parsedPayment.success || parsedPayment.data.order_id !== orderId ||
          parsedPayment.data.total_cents !== totalCents
        ) {
          logger.warn("apply_order_payment_invalid_result");
          return json(
            req,
            { error: "APPLY_ORDER_PAYMENT_INVALID_RESULT" },
            500,
          );
        }
        const payment = parsedPayment.data;
        // create_order_intent supplies the SQL deposit requirement. A paid
        // deposit can leave a total balance without any of that requirement due.
        const dueNowCents = Math.max(
          0,
          Math.min(parsedDue.data, payment.effective_total_cents) -
            payment.paid_cents,
        );

        logger.info("offline_payment_applied", {
          orderId,
          amountCents,
        });

        logger.info("completed", {
          orderId,
          status: payment.status,
          markPaid: true,
        });

        return json(req, {
          ok: true,
          orderId,
          currency: String(currency).toUpperCase(),
          totalCents: payment.total_cents,
          status: payment.status,
          amountAppliedCents: payment.idempotent ? 0 : amountCents,
          dueNowCents,
          bookingToken: null,
          expiresAt: null,
          payment: payRes,
        });
      }

      logger.info("completed", {
        orderId,
        status: baseStatus,
        markPaid: false,
      });

      return json(req, {
        ok: true,
        orderId,
        currency: String(currency).toUpperCase(),
        totalCents,
        status: baseStatus,
        dueNowCents: typeof dueNowCentsRaw === "number" ? dueNowCentsRaw : null,
        bookingToken: rpcRes?.booking_token ?? null,
        expiresAt: rpcRes?.expires_at ?? null,
        amountAppliedCents: null,
        payment: null,
      });
    } catch (e) {
      if (e instanceof ResponseError) {
        logger.warn("response_error", {
          code: e.code,
          status: e.status,
        });

        return json(req, {
          error: e.code,
          ...(e.details ? { details: e.details } : {}),
        }, e.status);
      }

      logger.error("unexpected_error", serializeError(e));

      return json(req, {
        error: "UNEXPECTED_ERROR",
      }, 500);
    }
  },
);
