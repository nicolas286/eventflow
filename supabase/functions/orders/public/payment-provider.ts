import { assertStripeApiKey } from "../../_shared/environment-safety.ts";
import { conflict, internal } from "../../_shared/errors.ts";
import type { EventPaymentProvider } from "../../_shared/payments/provider.ts";
import type { AdminClient } from "../../_shared/supabase.ts";
import { StripeEventPaymentProvider } from "./stripe-payment-provider.ts";
import { isStripeConnectAllowedForOrganization } from "../../_shared/payments/stripe-access.ts";
import { BANK_TRANSFER_EVENT_PAYMENTS_ENABLED } from "../../../../shared/schemas/bank-transfer.ts";
import { getAcceptedOrganizationSalesTerms } from "../../_shared/payments/organization-sales-terms.ts";

export type ResolvedEventPaymentMethod =
  | {
      kind: "stripe";
      provider: EventPaymentProvider;
    }
  | {
      kind: "bank_transfer";
      beneficiary: string;
      iban: string;
    };

export async function resolveEventPaymentProvider(input: {
  admin: AdminClient;
  orgId: string;
  stripeSecretKey: string | null;
  providerSelection: string;
}): Promise<ResolvedEventPaymentMethod> {
  const { data: org, error } = await input.admin
    .from("organizations")
    .select(
      "created_by, payments_provider, bank_transfer_beneficiary, bank_transfer_iban, stripe_connected_account_id, stripe_details_submitted, stripe_charges_enabled, stripe_payouts_enabled, stripe_compliance_verified, stripe_requirements_disabled_reason, stripe_requirements_currently_due",
    )
    .eq("id", input.orgId)
    .maybeSingle();

  if (error || !org) throw internal("PAYMENTS_CONFIG_LOAD_FAILED");

  if (org.payments_provider === "bank_transfer") {
    if (!BANK_TRANSFER_EVENT_PAYMENTS_ENABLED) {
      throw conflict("BANK_TRANSFER_DISABLED");
    }
    const beneficiary = String(org.bank_transfer_beneficiary ?? "").trim();
    const iban = String(org.bank_transfer_iban ?? "").trim();
    if (!beneficiary || !iban) {
      throw conflict("ORG_BANK_TRANSFER_CONFIGURATION_INCOMPLETE");
    }

    return { kind: "bank_transfer", beneficiary, iban };
  }

  if (org.payments_provider !== "stripe") {
    throw conflict("ORG_PAYMENT_METHOD_REQUIRES_CONFIGURATION");
  }

  const stripeAllowed = await isStripeConnectAllowedForOrganization(
    input.admin,
    org.created_by,
  );
  if (!stripeAllowed) {
    throw conflict("ORG_PAYMENT_METHOD_REQUIRES_CONFIGURATION");
  }

  await getAcceptedOrganizationSalesTerms(input.admin, input.orgId);

  const providerSelection = input.providerSelection.trim().toLowerCase();
  if (providerSelection === "disabled") {
    throw conflict("PAYMENTS_TEMPORARILY_DISABLED");
  }
  if (providerSelection !== "stripe") {
    throw internal("EVENT_PAYMENT_PROVIDER_INVALID");
  }

  if (!input.stripeSecretKey) throw internal("STRIPE_SECRET_KEY_MISSING");
  assertStripeApiKey(input.stripeSecretKey);

  if (
    !org.stripe_connected_account_id ||
    !org.stripe_compliance_verified ||
    org.stripe_requirements_disabled_reason ||
    (Array.isArray(org.stripe_requirements_currently_due) &&
      org.stripe_requirements_currently_due.length > 0) ||
    !org.stripe_details_submitted ||
    !org.stripe_charges_enabled ||
    !org.stripe_payouts_enabled
  ) {
    throw conflict("ORG_STRIPE_ONBOARDING_INCOMPLETE");
  }

  return {
    kind: "stripe",
    provider: new StripeEventPaymentProvider(
      input.stripeSecretKey,
      org.stripe_connected_account_id,
    ),
  };
}
