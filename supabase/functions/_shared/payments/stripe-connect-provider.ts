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
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
};

function toStatus(account: StripeAccount): ConnectedAccountStatus {
  return {
    provider: "stripe",
    providerAccountId: requireStripeId(
      account.id,
      "STRIPE_CONNECTED_ACCOUNT_ID_MISSING",
    ),
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
        idempotencyKey: `eventflow-connect-${input.orgId}`,
        params: {
          type: "express",
          email: input.email,
          "business_profile[name]": input.displayName,
          "metadata[eventflow_org_id]": input.orgId,
          "capabilities[card_payments][requested]": true,
          "capabilities[transfers][requested]": true,
        },
      },
    );

    return toStatus(account);
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

    return toStatus(account);
  }
}
