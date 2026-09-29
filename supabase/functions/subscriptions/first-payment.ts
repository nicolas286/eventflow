import { assertMollieApiKey } from "../_shared/environment-safety.ts";
import { BodyTooLargeError } from "../_shared/app/request-body.ts";
import {
  mollieWebhookResourceSchema,
  parseWebhookId,
} from "./webhook-contracts.ts";
import { generateInvoicePdf } from "../_shared/services/invoice-pdf/index.ts";
import { sendInvoiceToBillit } from "../_shared/services/billit/index.ts";
import { runInBackground } from "../_shared/app/background.ts";
import { createClient } from "@supabase/supabase-js";
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
function planToPricing(plan: unknown) {
  const p = String(plan ?? "").trim().toLowerCase();
  if (p === "starter") {
    return {
      value: "15.99",
      currency: "EUR",
      interval: "1 month",
    };
  }
  if (p === "pro") {
    return {
      value: "25.99",
      currency: "EUR",
      interval: "1 month",
    };
  }
  return null;
}
function addMonthsYmd(from: Date, months: number) {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
export async function handleFirstPayment(req: Request): Promise<Response> {
  try {
    if (req.method !== "POST") {
      return json({
        error: "Method not allowed",
      }, 405);
    }
    const mollieKey = Deno.env.get("MOLLIE_API_KEY");
    assertMollieApiKey(mollieKey);
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const functionsBase = Deno.env.get("FUNCTIONS_URL");
    if (!mollieKey || !supabaseUrl || !serviceKey || !functionsBase) {
      return json({
        error: "Server misconfigured",
      }, 500);
    }
    const paymentId = await parseWebhookId(req);
    if (!paymentId) {
      return json({
        ok: true,
        ignored: true,
        reason: "missing_payment_id",
      }, 200);
    }
    const payRes = await fetch(
      `https://api.mollie.com/v2/payments/${paymentId}`,
      {
        headers: {
          Authorization: `Bearer ${mollieKey}`,
        },
      },
    );
    if (!payRes.ok) {
      const txt = await payRes.text();
      console.error("[sub-pay-webhook] mollie fetch payment failed", txt);
      return json({
        ok: true,
        ignored: true,
        reason: "mollie_fetch_failed",
      }, 200);
    }
    const pay = mollieWebhookResourceSchema.parse(await payRes.json());
    const status = String(pay?.status ?? "").toLowerCase();
    const sequenceType = String(pay?.sequenceType ?? "").toLowerCase();
    if (sequenceType && sequenceType !== "first") {
      return json({
        ok: true,
        ignored: true,
        reason: `not_first_${sequenceType}`,
      }, 200);
    }
    const customerId = pay?.customerId;
    const meta = pay?.metadata ?? {};
    const orgId = meta?.org_id;
    const plan = meta?.plan;
    const kind = meta?.kind;
    if (kind !== "subscription_first") {
      return json({
        ok: true,
        ignored: true,
        reason: "not_subscription_first",
      }, 200);
    }
    if (status !== "paid") {
      return json({
        ok: true,
        ignored: true,
        reason: `status_${status || "unknown"}`,
      }, 200);
    }
    if (!customerId || !orgId || !plan) {
      return json({
        ok: true,
        ignored: true,
        reason: "missing_metadata",
      }, 200);
    }
    const admin = createClient(supabaseUrl, serviceKey, {
      global: {
        headers: {
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    });
    // ✅ relire le tarif figé en DB
    const { data: subPricingRow, error: subPricingErr } = await admin.from(
      "subscriptions",
    ).select(
      "billing_price_value, billing_currency, discount_percent, promo_code",
    ).eq("org_id", orgId).maybeSingle();
    if (subPricingErr) {
      console.error(
        "[sub-pay-webhook] load billing pricing failed",
        subPricingErr,
      );
      return json({
        ok: false,
        retry: true,
        reason: "load_billing_pricing_failed",
      }, 500);
    }
    const pricing = subPricingRow?.billing_price_value
      ? {
        value: String(subPricingRow.billing_price_value),
        currency: String(subPricingRow.billing_currency ?? "EUR"),
        interval: "1 month",
      }
      : planToPricing(plan);
    if (!pricing) {
      return json({
        ok: true,
        ignored: true,
        reason: "unknown_plan",
      }, 200);
    }
    /* --- 1) créer la facture du first payment --- */ const {
      data: invoice,
      error: invErr,
    } = await admin.rpc("rpc_create_invoice_from_mollie_payment", {
      p_input: {
        org_id: orgId,
        mollie_payment_id: String(pay?.id ?? paymentId),
        mollie_subscription_id: null,
        currency: pay?.amount?.currency ?? "EUR",
        total_value: pay?.amount?.value ?? null,
        paid_at: pay?.paidAt
          ? new Date(String(pay.paidAt)).toISOString()
          : new Date().toISOString(),
        period_start: null,
        period_end: null,
        raw: pay,
      },
    });
    if (invErr) {
      console.error("[sub-pay-webhook] invoice first payment failed", {
        message: invErr.message,
        code: invErr.code,
        details: invErr.details,
        hint: invErr.hint,
      });
      return json({
        ok: false,
        retry: true,
        reason: "invoice_first_failed",
      }, 500);
    }
    const invoiceId = invoice?.id ??
      (Array.isArray(invoice) ? invoice[0]?.id : null) ?? invoice?.invoice_id ??
      null;
    if (!invoiceId) {
      console.error(
        "[sub-pay-webhook] invoice created but no id returned",
        invoice,
      );
    } else {
      await runInBackground(
        generateInvoicePdf(admin, invoiceId)
          .catch((e: unknown) =>
            console.error("[sub-pay-webhook] pdf generation failed", e)
          ),
      );
      await runInBackground(
        sendInvoiceToBillit(admin, invoiceId).catch((e: unknown) =>
          console.error("[sub-pay-webhook] billit processing failed", e)
        ),
      );
    }
    const subWebhookUrl =
      `${functionsBase}/subscriptions/webhooks/recurring-payment`;
    const { data: srow, error: sErr } = await admin.from("subscriptions")
      .select("mollie_subscription_id, status").eq("org_id", orgId)
      .maybeSingle();
    if (sErr) {
      console.error("[sub-pay-webhook] load subscription failed", sErr);
      return json({
        ok: true,
        ignored: true,
        reason: "db_read_failed",
      }, 200);
    }
    const st = String(srow?.status ?? "").toLowerCase();
    const hasLiveSub = Boolean(srow?.mollie_subscription_id) && ![
      "canceled",
      "cancelled",
      "expired",
      "completed",
    ].includes(st);
    if (hasLiveSub) {
      return json({
        ok: true,
        reused: true,
        reason: "already_has_live_subscription",
      }, 200);
    }
    const paidAt = pay?.paidAt ? new Date(String(pay.paidAt)) : new Date();
    const startDate = addMonthsYmd(paidAt, 1);
    const { data: orgRow } = await admin.from("organizations").select("name")
      .eq("id", orgId).single();
    const orgName = orgRow?.name ?? orgId;
    const subRes = await fetch(
      `https://api.mollie.com/v2/customers/${customerId}/subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${mollieKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: {
            currency: pricing.currency,
            value: pricing.value,
          },
          interval: pricing.interval,
          startDate,
          description: `EventFlow ${plan.toUpperCase()} - ${orgName}`,
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
      const txt = await subRes.text();
      console.error("[sub-pay-webhook] create subscription failed", txt);
      return json({
        ok: true,
        ignored: true,
        reason: "create_subscription_failed",
      }, 200);
    }
    const sub = mollieWebhookResourceSchema.parse(await subRes.json());
    const subscriptionId = sub?.id;
    const subStatus = sub?.status ?? "pending";
    const periodEnd = sub?.nextPaymentDate
      ? new Date(String(sub.nextPaymentDate)).toISOString()
      : null;
    if (!subscriptionId) {
      return json({
        ok: true,
        ignored: true,
        reason: "missing_subscription_id",
      }, 200);
    }
    const { error } = await admin.rpc("apply_subscription_state", {
      p_org_id: orgId,
      p_provider: "mollie",
      p_customer_id: customerId,
      p_subscription_id: subscriptionId,
      p_status: subStatus,
      p_current_period_end: periodEnd,
      p_raw: sub,
    });
    if (error) {
      console.error("[sub-pay-webhook] apply_subscription_state failed", error);
      return json({
        ok: true,
        ignored: true,
        reason: "apply_failed",
      }, 200);
    }
    return json({
      ok: true,
      pricingUsed: {
        value: pricing.value,
        currency: pricing.currency,
      },
    }, 200);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return json({ error: e.message }, 413);
    console.error("[sub-pay-webhook] unexpected", e);
    return json({
      ok: true,
      ignored: true,
      reason: "unexpected",
    }, 200);
  }
}
