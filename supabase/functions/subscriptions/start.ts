import { createClient } from "@supabase/supabase-js";
import { BodyTooLargeError } from "../_shared/app/request-body.ts";

import { loadEnv, resolveReturnBaseUrl } from "./env.ts";
import { corsHeaders, getBearer, json, readJson } from "./http.ts";
import {
  getCheckoutHref,
  hasActiveMandate,
  mollieFetch,
  tryCancelExistingSubscription,
} from "./mollie.ts";
import { resolvePricing } from "./pricing.ts";
import { parseStartSubscriptionPayload } from "./schema.ts";
import { loadSubscription, subscriptionSelect } from "./subscription.ts";

/* ---------------- Handler ---------------- */

export async function startSubscription(req: Request): Promise<Response> {
  try {
    if (req.method === "OPTIONS") {
      const origin = req.headers.get("origin");

      return new Response("ok", {
        headers: corsHeaders(origin),
      });
    }

    if (req.method !== "POST") {
      return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);
    }

    const token = getBearer(req);

    if (!token) {
      return json(req, { error: "NOT_AUTHENTICATED" }, 401);
    }

    const bodyRaw = await readJson(req);
    const parsed = parseStartSubscriptionPayload(bodyRaw);

    if (!parsed.success) {
      return json(req, { error: "VALIDATION_ERROR" }, 400);
    }

    const { orgId, plan, promoCode } = parsed.data;

    const env = loadEnv();

    if (!env) {
      return json(req, { error: "SERVER_MISCONFIGURED" }, 500);
    }

    const returnBaseUrl = resolveReturnBaseUrl(req);

    if (!returnBaseUrl) {
      return json(req, { error: "ORIGIN_NOT_ALLOWED" }, 403);
    }

    const userClient = createClient(env.supabaseUrl, env.anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const service = createClient(env.supabaseUrl, env.serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();

    if (userErr || !userData?.user) {
      return json(req, { error: "INVALID_SESSION" }, 401);
    }

    const userId = userData.user.id;
    const userEmail = userData.user.email ?? null;

    const { data: om, error: omErr } = await service
      .from("organization_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .in("role", ["owner", "admin"])
      .limit(1);

    if (omErr) {
      return json(req, { error: "AUTH_CHECK_FAILED" }, 500);
    }

    if (!om || om.length === 0) {
      return json(req, { error: "FORBIDDEN" }, 403);
    }

    const { data: existing, error: exErr } = await loadSubscription(
      service,
      orgId,
    );

    if (
      !exErr &&
      existing?.status === "active" &&
      existing?.plan === plan &&
      existing?.mollie_subscription_id
    ) {
      return json(req, {
        ok: true,
        action: "sub_created",
        orgId,
        plan,
        mollieCustomerId: existing.mollie_customer_id,
        mollieSubscriptionId: existing.mollie_subscription_id,
        status: existing.status,
        currentPeriodEnd: existing.current_period_end,
        reused: true,
      });
    }

    console.log("[start-subscription] payload", { orgId, plan, promoCode });

    const { data: intent, error: intentErr } = await userClient.rpc(
      "create_subscription_intent",
      {
        p_org_id: orgId,
        p_plan: plan,
      },
    );

    if (intentErr) {
      return json(req, { error: intentErr.message }, 400);
    }

    const { data: latest, error: latestErr } = await loadSubscription(
      service,
      orgId,
    );

    if (latestErr) {
      return json(req, {
        error: "LOAD_SUBSCRIPTION_AFTER_INTENT_FAILED",
        details: latestErr.message,
      }, 500);
    }

    const current = latest ?? existing ?? null;

    const { pricing, promo } = resolvePricing({
      plan,
      promoCode,
      current,
    });

    const { data: org, error: orgErr } = await service
      .from("organizations")
      .select("id, name")
      .eq("id", orgId)
      .maybeSingle();

    if (orgErr || !org) {
      return json(req, { error: "ORGANIZATION_NOT_FOUND" }, 404);
    }

    let mollieCustomerId = current?.mollie_customer_id ??
      intent?.mollie_customer_id ?? null;

    if (!mollieCustomerId) {
      const { res: custRes, data: custData, rawText } = await mollieFetch(
        "https://api.mollie.com/v2/customers",
        env.mollieKey,
        {
          method: "POST",
          body: JSON.stringify({
            name: org.name ?? `Org ${orgId}`,
            email: userEmail,
            metadata: {
              org_id: orgId,
            },
          }),
        },
      );

      if (!custRes.ok) {
        return json(req, {
          error: "MOLLIE_CREATE_CUSTOMER_FAILED",
          details: rawText,
        }, 502);
      }

      mollieCustomerId = custData?.id ?? null;

      if (!mollieCustomerId) {
        return json(req, { error: "MOLLIE_CUSTOMER_MISSING_ID" }, 502);
      }
    }

    await service
      .from("subscriptions")
      .update({
        mollie_customer_id: mollieCustomerId,
        promo_code: promo.applied ? promo.promoCode : null,
        discount_percent: promo.applied ? promo.discountPercent : null,
        billing_price_value: pricing.value,
        billing_currency: pricing.currency,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", orgId);

    const existingSubId = current?.mollie_subscription_id ?? null;
    const existingPlan = current?.plan?.toLowerCase() ?? null;

    const shouldCancelExisting = Boolean(existingSubId) &&
      Boolean(existingPlan) && existingPlan !== plan;

    if (shouldCancelExisting && existingSubId) {
      const cancelCustomerId = current?.mollie_customer_id ?? mollieCustomerId;

      const cancel = await tryCancelExistingSubscription({
        mollieKey: env.mollieKey,
        customerId: cancelCustomerId,
        subscriptionId: existingSubId,
      });

      if (!cancel.ok) {
        console.error("[subscription] cancel failed", {
          orgId,
          cancelCustomerId,
          existingSubId,
          error: cancel.error,
          details: cancel.details,
        });

        return json(req, { error: cancel.error }, 502);
      }

      await service
        .from("subscriptions")
        .update({
          updated_at: new Date().toISOString(),
        })
        .eq("org_id", orgId);
    }

    const mandate = await hasActiveMandate(env.mollieKey, mollieCustomerId);

    if (!mandate.ok) {
      return json(req, {
        error: mandate.error,
        details: mandate.details,
      }, 502);
    }

    const billingReturnUrl = `${returnBaseUrl}/admin/abonnement?return=1&org=${
      encodeURIComponent(orgId)
    }`;
    const paymentWebhookUrl =
      `${env.functionsBase}/subscriptions/webhooks/first-payment`;

    if (!mandate.active) {
      const { res: payRes, data: payData, rawText } = await mollieFetch(
        `https://api.mollie.com/v2/customers/${mollieCustomerId}/payments`,
        env.mollieKey,
        {
          method: "POST",
          body: JSON.stringify({
            amount: {
              currency: pricing.currency,
              value: pricing.value,
            },
            description:
              `EventFlow ${plan.toUpperCase()} - ${org.name} - 1er mois`,
            redirectUrl: billingReturnUrl,
            webhookUrl: paymentWebhookUrl,
            sequenceType: "first",
            method: ["creditcard", "directdebit"],
            metadata: {
              org_id: orgId,
              plan,
              kind: "subscription_first",
            },
          }),
        },
      );

      if (!payRes.ok) {
        return json(req, {
          error: "MOLLIE_CREATE_FIRST_PAYMENT_FAILED",
          details: rawText,
        }, 502);
      }

      const checkoutUrl = getCheckoutHref(payData);
      const paymentId = payData?.id ?? null;

      if (!checkoutUrl || !paymentId) {
        return json(req, {
          error: "MISSING_CHECKOUT_URL",
          details: payData,
        }, 502);
      }

      return json(req, {
        ok: true,
        action: "checkout",
        orgId,
        plan,
        mollieCustomerId,
        checkoutUrl,
        paymentId,
        canceledPrevious: shouldCancelExisting,
        returnBaseUrl,
        promoApplied: promo.applied,
        discountPercent: promo.discountPercent,
        billingPriceValue: pricing.value,
      });
    }

    const subWebhookUrl =
      `${env.functionsBase}/subscriptions/webhooks/recurring-payment`;

    const { res: subRes, data: subData, rawText } = await mollieFetch(
      `https://api.mollie.com/v2/customers/${mollieCustomerId}/subscriptions`,
      env.mollieKey,
      {
        method: "POST",
        body: JSON.stringify({
          amount: {
            currency: pricing.currency,
            value: pricing.value,
          },
          interval: pricing.interval,
          description: `Eventflow ${plan.toUpperCase()} • ${org.name ?? orgId}`,
          webhookUrl: subWebhookUrl,
          metadata: {
            org_id: orgId,
            plan,
            kind: "platform_subscription",
          },
        }),
      },
    );

    if (!subRes.ok) {
      return json(req, {
        error: "MOLLIE_CREATE_SUBSCRIPTION_FAILED",
        details: rawText,
      }, 502);
    }

    const mollieSubscriptionId = subData?.id;
    const mollieStatus = subData?.status ?? "pending";

    const periodEnd = subData?.nextPaymentDate
      ? new Date(subData.nextPaymentDate).toISOString()
      : null;

    if (!mollieSubscriptionId) {
      return json(req, { error: "MOLLIE_SUBSCRIPTION_MISSING_ID" }, 502);
    }

    const { data: up, error: upErr } = await service
      .from("subscriptions")
      .upsert(
        {
          org_id: orgId,
          mollie_customer_id: mollieCustomerId,
          mollie_subscription_id: mollieSubscriptionId,
          plan,
          status: String(mollieStatus ?? "pending").toLowerCase(),
          current_period_end: periodEnd,
          promo_code: promo.applied
            ? promo.promoCode
            : current?.promo_code ?? null,
          discount_percent: promo.applied
            ? promo.discountPercent
            : current?.discount_percent ?? null,
          billing_price_value: pricing.value,
          billing_currency: pricing.currency,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "org_id",
        },
      )
      .select(subscriptionSelect)
      .single();

    if (upErr) {
      return json(req, {
        error: "DB_UPSERT_FAILED",
        details: upErr.message,
      }, 500);
    }

    if (!up?.mollie_subscription_id) {
      return json(req, {
        error: "DB_UPSERT_NO_SUB_ID",
        details: up,
      }, 500);
    }

    const rawForDb = {
      ...subData,
      metadata: {
        ...(subData?.metadata ?? {}),
        org_id: orgId,
        plan,
        kind: "platform_subscription",
      },
    };

    const { error: applyErr } = await service.rpc("apply_subscription_state", {
      p_org_id: orgId,
      p_provider: "mollie",
      p_customer_id: mollieCustomerId,
      p_subscription_id: mollieSubscriptionId,
      p_status: mollieStatus,
      p_current_period_end: periodEnd,
      p_raw: rawForDb,
    });

    if (applyErr) {
      return json(req, {
        ok: false,
        warning: "subscription_created_but_db_not_updated",
        details: applyErr.message,
        mollieCustomerId,
        mollieSubscriptionId,
        status: mollieStatus,
        canceledPrevious: shouldCancelExisting,
      });
    }

    return json(req, {
      ok: true,
      action: "sub_created",
      orgId,
      plan,
      mollieCustomerId,
      mollieSubscriptionId,
      status: mollieStatus,
      currentPeriodEnd: periodEnd,
      canceledPrevious: shouldCancelExisting,
      returnBaseUrl,
      promoApplied: promo.applied,
      discountPercent: promo.discountPercent,
      billingPriceValue: pricing.value,
    });
  } catch (e) {
    if (e instanceof BodyTooLargeError) {
      return json(req, { error: e.message }, 413);
    }
    return json(req, {
      error: "UNEXPECTED_ERROR",
      details: String(e),
    }, 500);
  }
}
