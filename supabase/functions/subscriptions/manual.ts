import { createClient } from "@supabase/supabase-js";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { createEdgeLogger } from "../_shared/modules/logger/mod.ts";
import { completeManualInvoiceDelivery } from "./invoice-delivery.ts";
import { parseStartSubscriptionPayload } from "./schema.ts";
import { applyDiscount, planToPricing, resolvePromo } from "./pricing.ts";
import { corsHeaders, getBearer, json, readJson } from "./http.ts";

function envTrim(name: string) {
  const value = Deno.env.get(name)?.trim();
  return value || null;
}

type ManualInvoiceResult = {
  ok: true;
  org_id: string;
  plan: "starter" | "pro";
  provider: "manual";
  status: "active";
  invoice_id: string;
  invoice_number: string;
  due_at: string;
  current_period_end: string;
  reused: boolean;
};

export async function handleManualStartSubscription(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders(req.headers.get("origin")),
    });
  }
  if (req.method !== "POST") {
    return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const token = getBearer(req);
  if (!token) return json(req, { error: "NOT_AUTHENTICATED" }, 401);

  const parsed = parseStartSubscriptionPayload(await readJson(req));
  if (!parsed.success) return json(req, { error: "VALIDATION_ERROR" }, 400);

  const supabaseUrl = envTrim("SUPABASE_URL");
  const anonKey = envTrim("SUPABASE_ANON_KEY");
  const serviceKey = envTrim("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(req, { error: "SERVER_MISCONFIGURED" }, 500);
  }

  const { orgId, plan, promoCode } = parsed.data;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return json(req, { error: "INVALID_SESSION" }, 401);
  }

  const { data: member, error: memberError } = await admin
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userData.user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (memberError) return json(req, { error: "AUTH_CHECK_FAILED" }, 500);
  if (!member) return json(req, { error: "FORBIDDEN" }, 403);

  const quota = await consumeRequestRateLimit({
    req, supabase: admin, logger: createEdgeLogger("subscriptions-start"),
    key: `user:${userData.user.id}:org:${orgId.toLowerCase()}`,
    ...applicationRateLimits.subscriptionStart,
  });
  if (!quota.allowed) return quota.response;

  const promo = resolvePromo({ plan, promoCode });
  const pricing = applyDiscount(planToPricing(plan), promo.discountPercent);
  const totalCents = Math.round(Number(pricing.value) * 100);
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    return json(req, { error: "INVALID_SUBSCRIPTION_PRICE" }, 500);
  }

  const { data, error } = await admin.rpc(
    "create_manual_subscription_invoice",
    {
      p_org_id: orgId,
      p_plan: plan,
      p_total_cents: totalCents,
      p_currency: pricing.currency,
      p_promo_code: promo.applied ? promo.promoCode : null,
      p_discount_percent: promo.applied ? promo.discountPercent : null,
    },
  );
  if (error) {
    const code = error.message.includes("billing profile missing")
      ? "BILLING_PROFILE_REQUIRED"
      : "INVOICE_CREATION_FAILED";
    return json(
      req,
      { error: code },
      code === "BILLING_PROFILE_REQUIRED" ? 400 : 500,
    );
  }

  const invoice = data as ManualInvoiceResult | null;
  if (!invoice?.invoice_id || !invoice.invoice_number || !invoice.due_at) {
    return json(req, { error: "INVOICE_CREATION_EMPTY_RESPONSE" }, 500);
  }

  const warnings = await completeManualInvoiceDelivery(
    admin,
    invoice.invoice_id,
  );

  return json(req, {
    ok: true,
    action: "invoice",
    provider: "manual",
    orgId,
    plan,
    status: "active",
    invoiceId: invoice.invoice_id,
    invoiceNumber: invoice.invoice_number,
    dueAt: invoice.due_at,
    currentPeriodEnd: invoice.current_period_end,
    reused: invoice.reused,
    promoApplied: promo.applied,
    discountPercent: promo.discountPercent,
    billingPriceValue: pricing.value,
    warnings,
  });
}
