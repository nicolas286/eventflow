import { assertStripeApiKey } from "../../_shared/environment-safety.ts";
import { conflict, internal } from "../../_shared/errors.ts";
import type { EventPaymentProvider } from "../../_shared/payments/provider.ts";
import type { AdminClient } from "../../_shared/supabase.ts";
import { StripeEventPaymentProvider } from "./stripe-payment-provider.ts";

export async function resolveEventPaymentProvider(input: {
  admin: AdminClient;
  orgId: string;
  stripeSecretKey: string | null;
  providerSelection: string;
}): Promise<EventPaymentProvider> {
  const providerSelection = input.providerSelection.trim().toLowerCase();
  if (providerSelection === "disabled") {
    throw conflict("PAYMENTS_TEMPORARILY_DISABLED");
  }
  if (providerSelection !== "stripe") {
    throw internal("EVENT_PAYMENT_PROVIDER_INVALID");
  }

  const { data: org, error } = await input.admin
    .from("organizations")
    .select(
      "stripe_connected_account_id, stripe_details_submitted, stripe_charges_enabled, stripe_payouts_enabled",
    )
    .eq("id", input.orgId)
    .maybeSingle();

  if (error || !org) throw internal("PAYMENTS_CONFIG_LOAD_FAILED");
  if (!input.stripeSecretKey) throw internal("STRIPE_SECRET_KEY_MISSING");
  assertStripeApiKey(input.stripeSecretKey);

  if (
    !org.stripe_connected_account_id ||
    !org.stripe_details_submitted ||
    !org.stripe_charges_enabled ||
    !org.stripe_payouts_enabled
  ) {
    throw conflict("ORG_STRIPE_ONBOARDING_INCOMPLETE");
  }

  return new StripeEventPaymentProvider(
    input.stripeSecretKey,
    org.stripe_connected_account_id,
  );
}
