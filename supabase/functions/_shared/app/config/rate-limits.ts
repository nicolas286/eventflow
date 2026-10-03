export const registerTicketsRateLimits = {
  ingress: {
    scope: "edge-ingress:register-tickets:1m",
    limit: 300,
    windowSeconds: 60,
  },
  registration: {
    scope: "register-tickets:10m",
    windowSeconds: 600,
  },
} as const;

export const accountRateLimits = {
  deletion: {
    scope: "accounts:delete:1h",
    limit: 5,
    windowSeconds: 3_600,
  },
} as const;

export const platformAdminRateLimits = {
  api: {
    scope: "platform-admin:1m",
    limit: 180,
    windowSeconds: 60,
  },
} as const;

// A8: independent fixed-window budgets; org keys are constructed only after
// authorization. Values intentionally leave room for retries and several tabs.
export const applicationRateLimits = {
  organizationCreate: {
    scope: "organizations:create:1h", limit: 3, windowSeconds: 3600,
    identity: "user", reason: "Atomic organization onboarding",
  },
  organizerRead: {
    scope: "organizer:read:1m", limit: 240, windowSeconds: 60,
    identity: "user-org", reason: "Organizer dashboard and resource reads",
  },
  organizerWrite: {
    scope: "organizer:write:1m", limit: 120, windowSeconds: 60,
    identity: "user-org", reason: "Bounded organizer changes and reordering",
  },
  connectStart: {
    scope: "stripe-connect:start:10m",
    limit: 10,
    windowSeconds: 600,
    identity: "user-org",
    reason: "Account creation and onboarding links",
  },
  connectStatus: {
    scope: "stripe-connect:status:1m",
    limit: 120,
    windowSeconds: 60,
    identity: "user-org",
    reason: "Stripe reads and status persistence; polling allowed",
  },
  paymentSettingsRead: {
    scope: "payment-settings:read:1m",
    limit: 120,
    windowSeconds: 60,
    identity: "user-org",
    reason: "Repeated settings reads",
  },
  paymentSettingsUpdate: {
    scope: "payment-settings:update:10m",
    limit: 20,
    windowSeconds: 600,
    identity: "user-org",
    reason: "Bank updates and security email",
  },
  paymentSettingsAcceptTerms: {
    scope: "payment-settings:accept-terms:10m",
    limit: 30,
    windowSeconds: 600,
    identity: "user-org",
    reason: "Contract acceptance writes",
  },
  subscriptionStart: {
    scope: "subscriptions:start:10m",
    limit: 10,
    windowSeconds: 600,
    identity: "user-org",
    reason: "Invoice creation, PDF, email and Billit",
  },
  subscriptionCancel: {
    scope: "subscriptions:cancel:10m",
    limit: 10,
    windowSeconds: 600,
    identity: "user-org",
    reason: "Internal subscription mutation; retries allowed",
  },
  invoicePdf: {
    scope: "invoices:pdf:1m",
    limit: 60,
    windowSeconds: 60,
    identity: "user-org",
    reason: "PDF generation/storage signing across invoices",
  },
  adminOrderCreate: {
    scope: "orders:admin-create:1m",
    limit: 120,
    windowSeconds: 60,
    identity: "user-org",
    reason: "Desk registration bursts, SQL intent/payment",
  },
  adminOrderMarkPaid: {
    scope: "orders:admin-mark-paid:1m",
    limit: 60,
    windowSeconds: 60,
    identity: "user-org",
    reason: "Payment, ticket and confirmation delivery",
  },
  orderReadIp: {
    scope: "orders:read-ingress:1m",
    limit: 180,
    windowSeconds: 60,
    identity: "trusted-ip",
    reason:
      "All attempts including absent/invalid tokens; several polling tabs",
  },
  orderReadFallback: {
    scope: "orders:read-fallback:1m",
    limit: 6000,
    windowSeconds: 60,
    identity: "shared",
    reason: "Bounded availability fallback when trustworthy IP is absent",
  },
  orderReadResource: {
    scope: "orders:read-resource:1m",
    limit: 120,
    windowSeconds: 60,
    identity: "verified-order",
    reason:
      "Only after booking capability verification; no arbitrary counter IDs",
  },
  publicCatalogIp: {
    scope: "catalog:ingress:1m", limit: 240, windowSeconds: 60,
    identity: "trusted-ip", reason: "All public catalog attempts before resource lookup",
  },
  publicCatalogFallback: {
    scope: "catalog:fallback:1m", limit: 6000, windowSeconds: 60,
    identity: "shared", reason: "Bounded fallback when ingress IP is unverified",
  },
  publicCatalogResource: {
    scope: "catalog:resource:1m", limit: 240, windowSeconds: 60,
    identity: "verified-resource", reason: "Published resource only, across clients",
  },
  platformConfigIp: {
    scope: "platform-config:read:1m",
    limit: 120,
    windowSeconds: 60,
    identity: "trusted-ip",
    reason: "Public configuration read on navigation",
  },
  platformConfigFallback: {
    scope: "platform-config:fallback:1m",
    limit: 6000,
    windowSeconds: 60,
    identity: "shared",
    reason:
      "One bounded fallback across audiences, no client-chosen resource key",
  },
} as const;
