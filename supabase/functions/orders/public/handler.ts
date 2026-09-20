import { registerSuccessSchema } from "./registerTickets.contracts.ts";
import { registerTicketsRateLimits } from "../../_shared/app/config/rate-limits.ts";
import { createEdgeHandler } from "../../_shared/app/edge-handler/mod.ts";
import { json as baseJson } from "../../_shared/app/http.ts";
import { resolveRequestClientIp } from "../../_shared/app/client-ip.ts";
import { consumeRequestRateLimit } from "../../_shared/app/rate-limit/mod.ts";
import { ResponseError } from "../../_shared/errors.ts";
import { serializeError } from "../../_shared/modules/logger/mod.ts";

import { parseRegisterPayload } from "./validation.ts";
import { toCreateOrderIntentArgs } from "./registerTickets.contracts.ts";
import { resolveRuntimeConfig } from "./config.ts";
import { getEventPaymentContextOrThrow } from "./db.ts";
import { createOrderIntentOrThrow } from "./order-intent-repository.ts";
import { buildBuyer } from "./buyer.ts";
import { verifyCaptchaOrThrow } from "./turnstile.ts";
import { resolveCheckoutContextOrThrow } from "./checkout.ts";
import { getValidOrgMollieAccessOrThrow } from "./mollie-auth.ts";
import {
  createMolliePayment,
  findReusablePayment,
  insertPaymentOrRollback,
} from "./mollie-payments.ts";
import { completeFreeOrderOrThrow } from "./free-order.ts";
import { assertWidgetAllowedForOrgOrThrow } from "./widget.ts";

function json(req: Request, data: unknown, status = 200) {
  return baseJson(
    req,
    status < 400 ? registerSuccessSchema.parse(data) : data,
    status,
  );
}

export const handleRegisterTicketsRequest = createEdgeHandler(
  {
    name: "orders-public",
    method: "POST",
    auth: "none",
    serviceClient: true,
    onError: ({ req, logger, error }) => {
      if (error instanceof ResponseError) {
        logger.warn("response_error", {
          code: error.code,
          status: error.status,
        });
        return json(req, { error: error.code }, error.status);
      }

      logger.error("unexpected_error", { error: serializeError(error) });
      return json(req, { error: "UNEXPECTED_ERROR" }, 500);
    },
  },
  async ({ req, logger, serviceClient: admin }) => {
    const clientIp = await resolveRequestClientIp(req);
    const ip = clientIp?.ip ?? null;
    const ingressRateLimit = await consumeRequestRateLimit({
      req,
      supabase: admin,
      logger,
      key: `ip:${ip ?? "unresolved"}`,
      ...registerTicketsRateLimits.ingress,
    });
    if (!ingressRateLimit.allowed) return ingressRateLimit.response;

    const body = await parseRegisterPayload(req);

    logger.info("payload_parsed", {
      eventId: body.eventId,
      itemsCount: body.items.length,
      attendeesCount: body.attendees.length,
      checkoutSource: body.checkoutSource ?? null,
      hasBuyerEmail: Boolean(body.buyer?.email ?? body.buyerEmail),
      hasPromoCode: Boolean(body.promoCode),
    });

    const config = resolveRuntimeConfig(req);

    await verifyCaptchaOrThrow({
      token: body.turnstileToken,
      ip,
      turnstileSecret: config.turnstileSecret,
      turnstileBypass: config.turnstileBypass,
    });

    logger.info("captcha_verified", {
      turnstileBypass: config.turnstileBypass,
      clientIpSource: clientIp?.source ?? "unresolved",
    });

    const rateLimit = await consumeRequestRateLimit({
      req,
      supabase: admin,
      logger,
      key: `event:${body.eventId}:ip:${ip ?? "unresolved"}`,
      scope: registerTicketsRateLimits.registration.scope,
      limit: config.registerRateLimitPer10Min,
      windowSeconds: registerTicketsRateLimits.registration.windowSeconds,
    });
    if (!rateLimit.allowed) return rateLimit.response;

    const checkout = resolveCheckoutContextOrThrow(body, config);

    logger.info("checkout_resolved", {
      checkoutSource: checkout.checkoutSource,
    });

    const buyer = buildBuyer(body);

    const order = await createOrderIntentOrThrow({
      admin,
      args: {
        ...toCreateOrderIntentArgs(body, rateLimit.keyHash),
        p_buyer: buyer,
      },
    });

    logger.info("order_created", {
      orderId: order.orderId,
      paymentRequired: order.paymentRequired,
      totalCents: order.totalCents,
      discountCents: order.discountCents,
      dueNowCents: order.dueNowCents,
      currency: order.currency,
    });

    const { orgId, eventTitle } = await getEventPaymentContextOrThrow(
      admin,
      body.eventId,
    );

    logger.info("payment_context_loaded", {
      orderId: order.orderId,
      orgId,
      eventTitle,
    });

    if (checkout.checkoutSource === "widget") {
      await assertWidgetAllowedForOrgOrThrow({
        admin,
        orgId,
        orderId: order.orderId,
        logger,
      });
    }

    if (!order.paymentRequired || order.dueNowCents === 0) {
      return await completeFreeOrderOrThrow({
        req,
        admin,
        order,
        config,
        logger,
      });
    }

    const mollieAuth = await getValidOrgMollieAccessOrThrow(
      admin,
      orgId,
    );

    logger.info("mollie_auth_loaded", {
      orgId,
      isTest: mollieAuth.isTest,
      hasProfileId: Boolean(mollieAuth.profileId),
    });

    const reusable = await findReusablePayment(admin, order.orderId);

    if (reusable) {
      logger.info("reusable_payment_found", {
        orderId: order.orderId,
      });

      return json(req, {
        ok: true,
        orderId: order.orderId,
        status: "awaiting_payment",
        checkoutUrl: reusable.checkoutUrl,
        amountDueNowCents: order.dueNowCents,
        totalCents: order.totalCents,
        discountCents: order.discountCents,
        reusedPayment: true,
        bookingToken: order.bookingToken,
      });
    }

    logger.info("mollie_payment_create_start", {
      orderId: order.orderId,
      orgId,
      dueNowCents: order.dueNowCents,
      totalCents: order.totalCents,
      discountCents: order.discountCents,
      currency: order.currency,
    });

    const payment = await createMolliePayment({
      accessToken: mollieAuth.accessToken,
      profileId: mollieAuth.profileId,
      isTest: mollieAuth.isTest,
      orderId: order.orderId,
      orgId,
      bookingToken: order.bookingToken,
      dueNowCents: order.dueNowCents,
      totalCents: order.totalCents,
      currency: order.currency,
      redirectUrl: checkout.buildRedirectUrl(
        order.orderId,
        order.bookingToken,
      ),
      webhookUrl: `${config.functionsBase}/mollie-webhook-tickets`,
      eventTitle,
      buyerEmail: buyer.email,
    });

    logger.info("mollie_payment_created", {
      orderId: order.orderId,
      providerPaymentId: payment.providerPaymentId,
    });

    await insertPaymentOrRollback({
      admin,
      accessToken: mollieAuth.accessToken,
      isTest: mollieAuth.isTest,
      orderId: order.orderId,
      dueNowCents: order.dueNowCents,
      currency: order.currency,
      molliePayment: payment.raw,
      providerPaymentId: payment.providerPaymentId,
    });

    logger.info("payment_inserted", {
      orderId: order.orderId,
      providerPaymentId: payment.providerPaymentId,
    });

    logger.info("completed_awaiting_payment", {
      orderId: order.orderId,
      reusedPayment: false,
    });

    return json(req, {
      ok: true,
      orderId: order.orderId,
      status: "awaiting_payment",
      checkoutUrl: payment.checkoutUrl,
      amountDueNowCents: order.dueNowCents,
      totalCents: order.totalCents,
      reusedPayment: false,
      bookingToken: order.bookingToken,
      discountCents: order.discountCents,
    });
  },
);
