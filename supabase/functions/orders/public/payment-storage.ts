import type {
  CreatedEventPayment,
  EventPaymentProvider,
  PaymentProviderName,
} from "../../_shared/payments/provider.ts";
import { internal } from "../../_shared/errors.ts";
import type { AdminClient } from "../../_shared/supabase.ts";

function checkoutUrl(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as {
    url?: unknown;
    _links?: { checkout?: { href?: unknown } };
  };
  if (typeof value.url === "string" && value.url) return value.url;
  const mollieUrl = value._links?.checkout?.href;
  return typeof mollieUrl === "string" && mollieUrl ? mollieUrl : null;
}

export async function findReusableProviderPayment(
  admin: AdminClient,
  orderId: string,
  provider: PaymentProviderName,
) {
  let query = admin
    .from("payments")
    .select(
      "provider_payment_id, provider_checkout_session_id, checkout_expires_at, raw, created_at",
    )
    .eq("order_id", orderId)
    .eq("provider", provider)
    .in("status", ["open", "pending"])
    .eq("is_refund", false)
    .order("created_at", { ascending: false });

  if (provider === "stripe") {
    query = query.gt("checkout_expires_at", new Date().toISOString());
  }

  const { data, error } = await query.limit(1).maybeSingle();

  if (error || !data?.provider_payment_id) return null;
  const url = checkoutUrl(data.raw);
  if (!url) return null;

  return {
    providerPaymentId: data.provider_payment_id as string,
    providerCheckoutSessionId:
      (data.provider_checkout_session_id as string | null) ?? null,
    checkoutUrl: url,
  };
}

export async function insertProviderPaymentOrRollback(input: {
  admin: AdminClient;
  provider: EventPaymentProvider;
  payment: CreatedEventPayment;
  orderId: string;
  amountCents: number;
  currency: string;
}) {
  if (
    input.payment.provider === "stripe" &&
    input.payment.providerAccountId &&
    input.payment.providerCheckoutSessionId &&
    input.payment.checkoutExpiresAt &&
    input.payment.orderExpiresAt
  ) {
    const { error } = await input.admin.rpc("store_stripe_checkout_payment", {
      p_order_id: input.orderId,
      p_provider_payment_id: input.payment.providerPaymentId,
      p_provider_account_id: input.payment.providerAccountId,
      p_checkout_session_id: input.payment.providerCheckoutSessionId,
      p_amount_cents: input.amountCents,
      p_currency: input.currency,
      p_checkout_expires_at: input.payment.checkoutExpiresAt,
      p_order_expires_at: input.payment.orderExpiresAt,
      p_raw: input.payment.raw,
    });

    if (!error) return;

    await input.provider.rollbackPayment(
      input.payment.providerCheckoutSessionId,
    );
    throw internal("PAYMENT_DB_INSERT_FAILED");
  }

  const now = new Date().toISOString();
  const { error } = await input.admin.from("payments").insert({
    order_id: input.orderId,
    provider: input.payment.provider,
    provider_payment_id: input.payment.providerPaymentId,
    provider_account_id: input.payment.providerAccountId,
    provider_checkout_session_id: input.payment.providerCheckoutSessionId,
    amount_cents: input.amountCents,
    currency: input.currency,
    status: "open",
    is_refund: false,
    created_at: now,
    updated_at: now,
    processed_at: null,
    checkout_expires_at: input.payment.checkoutExpiresAt,
    raw: input.payment.raw,
    type: "payment",
    parent_payment_id: null,
  });

  if (!error) return;

  await input.provider.rollbackPayment(
    input.payment.providerCheckoutSessionId ?? input.payment.providerPaymentId,
  );
  throw internal("PAYMENT_DB_INSERT_FAILED");
}
