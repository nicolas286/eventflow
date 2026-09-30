import type {
  ConnectedAccountProvider,
  ConnectedAccountStatus,
} from "./provider.ts";
import {
  requireStripeId,
  stripeRequest,
  type StripeRecord,
} from "./stripe-api.ts";

type StripeAccount = StripeRecord & {
  type?: string | null;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
  controller?: {
    fees?: { payer?: string | null };
    losses?: { payments?: string | null };
    requirement_collection?: string | null;
    stripe_dashboard?: { type?: string | null };
  } | null;
  requirements?: {
    disabled_reason?: string | null;
    currently_due?: unknown;
  } | null;
};

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
    : [];
}

function hasSupportedControllerConfiguration(account: StripeAccount) {
  if (account.type === "standard") return true;

  return (
    account.controller?.fees?.payer === "account" &&
    account.controller?.losses?.payments === "stripe" &&
    account.controller?.requirement_collection === "stripe" &&
    account.controller?.stripe_dashboard?.type === "full"
  );
}

export function stripeAccountToStatus(
  account: StripeAccount,
): ConnectedAccountStatus {
  return {
    provider: "stripe",
    providerAccountId: requireStripeId(
      account.id,
      "STRIPE_CONNECTED_ACCOUNT_ID_MISSING",
    ),
    accountType: nullableString(account.type),
    controllerFeesPayer: nullableString(account.controller?.fees?.payer),
    controllerLossesPayments: nullableString(
      account.controller?.losses?.payments,
    ),
    controllerRequirementCollection: nullableString(
      account.controller?.requirement_collection,
    ),
    controllerDashboardType: nullableString(
      account.controller?.stripe_dashboard?.type,
    ),
    requirementsDisabledReason: nullableString(
      account.requirements?.disabled_reason,
    ),
    requirementsCurrentlyDue: stringArray(account.requirements?.currently_due),
    configurationSupported: hasSupportedControllerConfiguration(account),
    detailsSubmitted: account.details_submitted === true,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
  };
}

export class StripeConnectedAccountProvider implements ConnectedAccountProvider {
  readonly name = "stripe" as const;

  constructor(private readonly secretKey: string) {}

  async createConnectedAccount(input: {
    orgId: string;
    email: string | null;
    displayName: string;
  }): Promise<ConnectedAccountStatus> {
    const account = await stripeRequest<StripeAccount>(
      this.secretKey,
      "/v1/accounts",
      {
        method: "POST",
        idempotencyKey: `eventflow-connect-standard-v2-${input.orgId}`,
        params: {
          // Standard/full-dashboard accounts keep Stripe responsible for
          // negative balances. Ticket Checkout remains a direct charge on
          // this account, so Eventflow never receives the ticket proceeds.
          type: "standard",
          "metadata[eventflow_org_id]": input.orgId,
          // Keep v2 parameters stable across retries by different admins and
          // organization renames. Stripe collects these fields in onboarding.
          // Stripe requires the base payment and transfer capabilities for
          // connected accounts; Checkout still offers Bancontact only.
          "capabilities[card_payments][requested]": true,
          "capabilities[transfers][requested]": true,
          "capabilities[bancontact_payments][requested]": true,
        },
      },
    );

    return stripeAccountToStatus(account);
  }

  async createAccountOnboardingLink(input: {
    providerAccountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<string> {
    const link = await stripeRequest<StripeRecord>(
      this.secretKey,
      "/v1/account_links",
      {
        method: "POST",
        params: {
          account: input.providerAccountId,
          type: "account_onboarding",
          return_url: input.returnUrl,
          refresh_url: input.refreshUrl,
          "collection_options[fields]": "eventually_due",
        },
      },
    );

    if (typeof link.url !== "string" || !link.url) {
      throw new Error("STRIPE_ACCOUNT_LINK_MISSING");
    }

    return link.url;
  }

  async getConnectedAccountStatus(
    providerAccountId: string,
  ): Promise<ConnectedAccountStatus> {
    const account = await stripeRequest<StripeAccount>(
      this.secretKey,
      `/v1/accounts/${encodeURIComponent(providerAccountId)}`,
    );

    return stripeAccountToStatus(account);
  }
}
