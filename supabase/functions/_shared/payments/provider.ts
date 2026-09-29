export type PaymentProviderName = "mollie" | "stripe";

export type ConnectedAccountStatus = {
  provider: PaymentProviderName;
  providerAccountId: string;
  accountType: string | null;
  controllerFeesPayer: string | null;
  controllerLossesPayments: string | null;
  controllerRequirementCollection: string | null;
  controllerDashboardType: string | null;
  requirementsDisabledReason: string | null;
  requirementsCurrentlyDue: string[];
  configurationSupported: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export type CreateEventPaymentInput = {
  orderId: string;
  orgId: string;
  bookingToken: string;
  amountCents: number;
  totalCents: number;
  currency: string;
  redirectUrl: string;
  eventTitle: string | null;
  buyerEmail: string | null;
  checkoutExpiresAt?: number;
};

export type CreatedEventPayment = {
  provider: PaymentProviderName;
  providerPaymentId: string;
  providerAccountId: string | null;
  providerCheckoutSessionId: string | null;
  checkoutUrl: string;
  checkoutExpiresAt?: string | null;
  orderExpiresAt?: string | null;
  raw: Record<string, unknown>;
};

export interface EventPaymentProvider {
  readonly name: PaymentProviderName;
  createPayment(input: CreateEventPaymentInput): Promise<CreatedEventPayment>;
  getPayment(providerPaymentId: string): Promise<Record<string, unknown>>;
  refundPayment(input: {
    providerPaymentId: string;
    amountCents?: number;
  }): Promise<Record<string, unknown>>;
  rollbackPayment(providerPaymentId: string): Promise<void>;
}

export interface ConnectedAccountProvider {
  readonly name: PaymentProviderName;
  createConnectedAccount(input: {
    orgId: string;
    email: string | null;
    displayName: string;
  }): Promise<ConnectedAccountStatus>;
  createAccountOnboardingLink(input: {
    providerAccountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<string>;
  getConnectedAccountStatus(
    providerAccountId: string,
  ): Promise<ConnectedAccountStatus>;
}

export type PaymentProvider = EventPaymentProvider & ConnectedAccountProvider;
