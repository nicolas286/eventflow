import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
type PaymentDescription = { eventTitle: string | null; buyerEmail: string | null; dueNowCents: number; currency: string };
type MolliePaymentInput = PaymentDescription & { accessToken: string; profileId: string | null; isTest: boolean; orderId: string; orgId: string; bookingToken: string; totalCents: number; redirectUrl: string; webhookUrl: string };
import { badGateway, internal } from "../../_shared/errors.ts";
import { toNonEmptyString } from "./buyer.ts";
function getCheckoutUrlFromRaw(raw: unknown) {
  const parsed = z.object({ _links: z.object({ checkout: z.object({ href: z.string() }) }) }).safeParse(raw);
  const href = parsed.success ? parsed.data._links.checkout.href : null;
  return typeof href === "string" && href.trim() ? href.trim() : null;
}
async function tryCancelMolliePayment(accessToken: string, paymentId: string, isTest: boolean) {
  try {
    const url = `https://api.mollie.com/v2/payments/${paymentId}${isTest ? "?testmode=true" : ""}`;
    await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });
  } catch  {
  // no-op
  }
}
function buildMollieDescription(opts: PaymentDescription) {
  const eventTitle = toNonEmptyString(opts.eventTitle) ?? "Événement";
  const buyerEmail = toNonEmptyString(opts.buyerEmail) ?? "acheteur inconnu";
  const amount = (opts.dueNowCents / 100).toFixed(2);
  const desc = `Eventflow — ${eventTitle} — ${buyerEmail} — ${amount} ${opts.currency}`;
  return desc.length > 255 ? desc.slice(0, 252) + "..." : desc;
}
export async function findReusablePayment(admin: SupabaseClient, orderId: string) {
  const { data, error } = await admin.from("payments").select("provider_payment_id, raw, created_at").eq("order_id", orderId).eq("provider", "mollie").in("status", [
    "open",
    "pending"
  ]).eq("is_refund", false).order("created_at", {
    ascending: false
  }).limit(1).maybeSingle();
  if (error || !data?.provider_payment_id) return null;
  const checkoutUrl = getCheckoutUrlFromRaw(data.raw);
  if (!checkoutUrl) return null;
  return {
    providerPaymentId: data.provider_payment_id,
    checkoutUrl
  };
}
export async function createMolliePayment(opts: MolliePaymentInput) {
  const description = buildMollieDescription({
    eventTitle: opts.eventTitle,
    buyerEmail: opts.buyerEmail,
    dueNowCents: opts.dueNowCents,
    currency: opts.currency
  });
  const res = await fetch("https://api.mollie.com/v2/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      amount: {
        currency: opts.currency,
        value: (opts.dueNowCents / 100).toFixed(2)
      },
      description,
      redirectUrl: opts.redirectUrl,
      webhookUrl: opts.webhookUrl,
      profileId: opts.profileId,
      testmode: opts.isTest,
      metadata: {
        order_id: opts.orderId,
        org_id: opts.orgId,
        booking_token: opts.bookingToken,
        kind: opts.dueNowCents < opts.totalCents ? "deposit" : "full"
      }
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(()=>"");
    throw badGateway("MOLLIE_PAYMENT_CREATE_FAILED", body);
  }
  const raw = await res.json();
  const providerPaymentId = raw?.id;
  const checkoutUrl = raw?._links?.checkout?.href;
  if (!providerPaymentId) {
    throw badGateway("MISSING_PROVIDER_PAYMENT_ID");
  }
  if (!checkoutUrl) {
    throw badGateway("MISSING_CHECKOUT_URL");
  }
  return {
    raw,
    providerPaymentId,
    checkoutUrl
  };
}
export async function insertPaymentOrRollback(opts: { admin: SupabaseClient; accessToken: string; isTest: boolean; orderId: string; dueNowCents: number; currency: string; molliePayment: unknown; providerPaymentId: string }) {
  const nowIso = new Date().toISOString();
  const { error } = await opts.admin.from("payments").insert({
    order_id: opts.orderId,
    provider: "mollie",
    provider_payment_id: opts.providerPaymentId,
    amount_cents: opts.dueNowCents,
    currency: opts.currency,
    status: "open",
    is_refund: false,
    created_at: nowIso,
    updated_at: nowIso,
    processed_at: null,
    raw: opts.molliePayment,
    type: "payment",
    parent_payment_id: null
  });
  if (error) {
    await tryCancelMolliePayment(opts.accessToken, opts.providerPaymentId, opts.isTest);
    throw internal("PAYMENT_DB_INSERT_FAILED");
  }
}
