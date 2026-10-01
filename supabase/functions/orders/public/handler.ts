import { registerSuccessSchema } from "./registerTickets.contracts.ts";
import { registerTicketsRateLimits } from "../../_shared/app/config/rate-limits.ts";
import { createEdgeHandler } from "../../_shared/app/edge-handler/mod.ts";
import { json as baseJson } from "../../_shared/app/http.ts";
import { resolveRequestClientIp } from "../../_shared/app/client-ip.ts";
import { consumeRequestRateLimit } from "../../_shared/app/rate-limit/mod.ts";
import { badRequest, internal, ResponseError } from "../../_shared/errors.ts";
import { serializeError } from "../../_shared/modules/logger/mod.ts";
import { StripeApiError } from "../../_shared/payments/stripe-api.ts";

import { parseRegisterPayload } from "./validation.ts";
import { toCreateOrderIntentArgs } from "./registerTickets.contracts.ts";
import { resolveRuntimeConfig } from "./config.ts";
import { getEventPaymentContextOrThrow } from "./db.ts";
import { createOrderIntentOrThrow } from "./order-intent-repository.ts";
import { buildBuyer } from "./buyer.ts";
import { verifyCaptchaOrThrow } from "./turnstile.ts";
import { resolveCheckoutContextOrThrow } from "./checkout.ts";
import {
  findReusableProviderPayment,
  insertProviderPaymentOrRollback,
} from "./payment-storage.ts";
import { resolveEventPaymentProvider } from "./payment-provider.ts";
import { completeFreeOrderOrThrow } from "./free-order.ts";
import { assertWidgetAllowedForOrgOrThrow } from "./widget.ts";
import { createBankTransferPaymentOrThrow } from "./bank-transfer.ts";
import { assertPlatformRegistrationsOpen } from "../platform-registration.ts";

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
          ...(error instanceof StripeApiError
            ? {
              providerStatus: error.providerStatus,
              stripeCode: error.stripeCode,
              stripeRequestId: error.requestId,
            }
            : {}),
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

    await assertPlatformRegistrationsOpen(admin);

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
    if (!buyer.email) throw badRequest("BUYER_EMAIL_REQUIRED");

    const { orgId, eventTitle } = await getEventPaymentContextOrThrow(
      admin,
      body.eventId,
    );

    const order = await createOrderIntentOrThrow({
      admin,
      platformTermsVersion: body.platformTermsVersion ?? "",
      organizerSalesTermsVersion: body.organizerSalesTermsVersion ?? null,
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

    const paymentMethod = await resolveEventPaymentProvider({
      admin,
      orgId,
      stripeSecretKey: config.stripeSecretKey,
      stripePaymentMethodConfigurationId:
        config.stripePaymentMethodConfigurationId,
      providerSelection: config.eventPaymentProvider,
    }).catch(async (error: unknown) => {
      // No provider call has happened: release only this unstarted reservation.
      const { error: releaseError } = await admin.rpc(
        "expire_unstarted_checkout",
        {
          p_order_id: order.orderId,
        },
      );
      if (releaseError) {
        logger.error("unstarted_checkout_release_failed", {
          orderId: order.orderId,
        });
      }
      throw error;
    });

    logger.info("payment_provider_loaded", {
      orgId,
      provider: paymentMethod.kind,
    });

    if (paymentMethod.kind === "bank_transfer") {
      const bankTransfer = await createBankTransferPaymentOrThrow({
        admin,
        logger,
        orderId: order.orderId,
        amountCents: order.dueNowCents,
        currency: order.currency,
        beneficiary: paymentMethod.beneficiary,
        iban: paymentMethod.iban,
        eventTitle,
        buyerEmail: buyer.email,
      });

      logger.info("completed_awaiting_bank_transfer", {
        orderId: order.orderId,
      });

      return json(req, {
        ok: true,
        orderId: order.orderId,
        status: "awaiting_payment",
        paymentMethod: "bank_transfer",
        amountDueNowCents: order.dueNowCents,
        totalCents: order.totalCents,
        bookingToken: order.bookingToken,
        discountCents: order.discountCents,
        bankTransfer,
      });
    }

    const paymentProvider = paymentMethod.provider;

    const reusable = await findReusableProviderPayment(
      admin,
      order.orderId,
      paymentProvider.name,
      paymentMethod.providerAccountId,
    );

    if (reusable) {
      logger.info("reusable_payment_found", {
        orderId: order.orderId,
      });

      return json(req, {
        ok: true,
        orderId: order.orderId,
        status: "awaiting_payment",
        paymentMethod: "stripe",
        checkoutUrl: reusable.checkoutUrl,
        amountDueNowCents: order.dueNowCents,
        totalCents: order.totalCents,
        discountCents: order.discountCents,
        reusedPayment: true,
        bookingToken: order.bookingToken,
      });
    }

    logger.info("payment_create_start", {
      orderId: order.orderId,
      orgId,
      provider: paymentProvider.name,
      dueNowCents: order.dueNowCents,
      totalCents: order.totalCents,
      discountCents: order.discountCents,
      currency: order.currency,
    });

    const { data: checkoutExpiresAt, error: reservationError } = await admin
      .rpc(
        "prepare_stripe_checkout",
        { p_order_id: order.orderId },
      );
    if (reservationError || typeof checkoutExpiresAt !== "number") {
      throw internal("STRIPE_RESERVATION_FAILED");
    }

    const payment = await paymentProvider.createPayment({
      orderId: order.orderId,
      orgId,
      bookingToken: order.bookingToken,
      amountCents: order.dueNowCents,
      totalCents: order.totalCents,
      currency: order.currency,
      redirectUrl: checkout.buildRedirectUrl(order.orderId, order.bookingToken),
      eventTitle,
      buyerEmail: buyer.email,
      checkoutExpiresAt,
    });

    logger.info("payment_created", {
      orderId: order.orderId,
      provider: paymentProvider.name,
      providerPaymentId: payment.providerPaymentId,
    });

    await insertProviderPaymentOrRollback({
      admin,
      provider: paymentProvider,
      payment,
      orderId: order.orderId,
      amountCents: order.dueNowCents,
      currency: order.currency,
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
      paymentMethod: "stripe",
      checkoutUrl: payment.checkoutUrl,
      amountDueNowCents: order.dueNowCents,
      totalCents: order.totalCents,
      reusedPayment: false,
      bookingToken: order.bookingToken,
      discountCents: order.discountCents,
    });
  },
);
