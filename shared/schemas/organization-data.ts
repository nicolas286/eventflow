import { z } from "zod";
export const profileSchema = z.object({
  userId: z.uuid(),
  firstName: z
    .string()
    .min(2, "Le prénom est trop court")
    .max(80, "Le prénom est trop long")
    .nullable()
    .optional(),
  lastName: z
    .string()
    .min(2, "Le nom est trop court")
    .max(80, "Le nom est trop long")
    .nullable()
    .optional(),
  phone: z
    .string()
    .min(3, "Le numéro de téléphone est trop court")
    .max(32, "Le numéro de téléphone est trop long")
    .nullable()
    .optional(),
  addressLine1: z
    .string()
    .min(3, "L'adresse est trop courte")
    .max(120, "L'adresse est trop longue")
    .nullable()
    .optional(),
  addressLine2: z
    .string()
    .min(3, "L'adresse est trop courte")
    .max(120, "L'adresse est trop longue")
    .nullable()
    .optional(),
  postalCode: z
    .string()
    .min(2, "Le code postal est trop court")
    .max(20, "Le code postal est trop long")
    .nullable()
    .optional(),
  city: z
    .string()
    .min(2, "La ville est trop courte")
    .max(80, "La ville est trop longue")
    .nullable()
    .optional(),
  country: z
    .string()
    .min(2, "Le pays est trop court")
    .max(80, "Le pays est trop long")
    .nullable()
    .optional(),
  countryCode: z
    .string()
    .length(2, "Le code pays doit contenir 2 lettres")
    .nullable()
    .optional(),
  stripeConnectAllowed: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Profile = z.infer<typeof profileSchema>;

export const organizationSchema = z.object({
  id: z.uuid(),
  type: z.enum(["association", "person"]),
  name: z
    .string()
    .min(3, "Le nom est trop court")
    .max(120, "Le nom est trop long"),
  status: z.enum(["trial", "active", "suspended"]),
  createdAt: z.string(),
  createdBy: z.uuid(),
  paymentsProvider: z.enum(["mollie", "stripe", "bank_transfer"]),
  paymentsStatus: z.enum(["not_connected", "pending", "connected", "revoked"]),
  paymentsLiveReady: z.boolean(),
  paymentsDetailsSubmitted: z.boolean().optional(),
  stripeConnectedAccountId: z.string().nullable().optional(),
  stripeDetailsSubmitted: z.boolean().optional(),
  stripeChargesEnabled: z.boolean().optional(),
  stripePayoutsEnabled: z.boolean().optional(),
  stripeComplianceVerified: z.boolean().optional(),
  stripeAccountType: z.string().nullable().optional(),
  stripeControllerFeesPayer: z.string().nullable().optional(),
  stripeControllerLossesPayments: z.string().nullable().optional(),
  stripeControllerRequirementCollection: z.string().nullable().optional(),
  stripeControllerDashboardType: z.string().nullable().optional(),
  stripeRequirementsDisabledReason: z.string().nullable().optional(),
  stripeRequirementsCurrentlyDue: z.array(z.string()).optional(),
  stripeDeauthorizedAt: z.string().nullable().optional(),
  stripeMigrationRequired: z.boolean().optional(),
  bankTransferBeneficiary: z.string().nullable().optional(),
  bankTransferIban: z.string().nullable().optional(),
  paymentsAccountUpdatedAt: z.string().nullable().optional(),
  plan: z.enum(["free", "pro", "starter"]),
  planStartedAt: z.string(),
  planExpiresAt: z.string().nullable(),
});

export type Organization = z.infer<typeof organizationSchema>;

const widgetColorSchema = z
  .string()
  .min(4, "Couleur trop courte")
  .max(20, "Couleur trop longue")
  .regex(/^#/, "La couleur doit commencer par #")
  .nullable()
  .optional();

export const organizationProfileSchema = z.object({
  orgId: z.uuid(),

  slug: z
    .string()
    .min(3, "Le slug est trop court")
    .max(150, "Le slug est trop long"),

  displayName: z
    .string()
    .min(3, "Le nom est trop court")
    .max(120, "Le nom est trop long"),

  description: z
    .string()
    .max(1000, "La description est trop longue")
    .nullable(),

  publicEmail: z.email("Email invalide").nullable(),

  phone: z
    .string()
    .min(3, "Le numéro de téléphone est trop court")
    .max(32, "Le numéro de téléphone est trop long")
    .nullable(),

  website: z
    .string()
    .min(5, "L'URL est trop courte")
    .max(2048, "L'URL est trop longue")
    .nullable(),

  logoUrl: z
    .string()
    .min(10, "L'URL du logo est trop courte")
    .max(2048, "L'URL du logo est trop longue")
    .nullable(),

  primaryColor: z
    .string()
    .min(4, "Couleur trop courte")
    .max(20, "Couleur trop longue")
    .regex(/^#/, "La couleur doit commencer par #")
    .nullable(),

  widgetBg: widgetColorSchema,
  widgetCard: widgetColorSchema,
  widgetText: widgetColorSchema,
  widgetButton: widgetColorSchema,

  createdAt: z.string(),
  updatedAt: z.string(),

  defaultEventBannerUrl: z
    .string()
    .min(10, "L'URL de la bannière est trop courte")
    .max(2048, "L'URL de la bannière est trop longue")
    .nullable(),

  emailReminderDaysBefore: z
    .number()
    .int()
    .min(0, "Le nombre de jours doit être positif")
    .nullable(),

  sellerLegalName: z.string().nullable().optional(),
  sellerAddress: z.string().nullable().optional(),
  sellerBusinessNumber: z.string().nullable().optional(),
  sellerType: z.enum(["professional", "non_professional"]).nullable()
    .optional(),
  connectTermsAcceptedVersion: z.string().nullable().optional(),
  dpaAcceptedVersion: z.string().nullable().optional(),
  platformTermsAcceptedVersion: z.string().nullable().optional(),
  privacyAcceptedVersion: z.string().nullable().optional(),
  salesTerms: z.string().max(10_000).nullable().optional(),
  salesTermsVersion: z.string().nullable().optional(),
  salesTermsAcceptedVersion: z.string().nullable().optional(),
  salesTermsAcceptedAt: z.string().nullable().optional(),
  salesTermsAcceptedBy: z.uuid().nullable().optional(),
});

export type OrganizationProfile = z.infer<typeof organizationProfileSchema>;

export const memberSchema = z.object({
  orgId: z.uuid(),
  userId: z.uuid(),
  role: z.enum(["admin", "owner"]),
  createdAt: z.string(),
});

export const membershipSchema = z
  .union([
    z.array(memberSchema),
    memberSchema,
  ])
  .transform((value) => (Array.isArray(value) ? value : [value]));

export type Member = z.infer<typeof memberSchema>;
export type Membership = z.infer<typeof membershipSchema>;

export const subscriptionSchema = z.object({
  orgId: z.uuid(),
  provider: z.enum(["mollie", "manual"]),
  status: z.string().trim().min(1),

  mollieCustomerId: z
    .string()
    .min(3, "L'ID client Mollie est trop court")
    .max(100, "L'ID client Mollie est trop long")
    .nullable(),

  mollieSubscriptionId: z
    .string()
    .min(3, "L'ID d'abonnement Mollie est trop court")
    .max(100, "L'ID d'abonnement Mollie est trop long")
    .nullable(),

  currentPeriodEnd: z.string().nullable(),
  currentPeriodStart: z.string().nullable().optional(),

  plan: z.enum(["free", "starter", "pro"]).nullable(),

  promoCode: z
    .string()
    .max(100, "Le code promo est trop long")
    .nullable()
    .optional(),

  discountPercent: z.number().int().min(0).max(100).nullable().optional(),

  billingPriceValue: z
    .string()
    .max(20, "La valeur de prix est trop longue")
    .nullable()
    .optional(),

  billingCurrency: z
    .string()
    .max(10, "La devise est trop longue")
    .nullable()
    .optional(),

  createdAt: z.string(),
  updatedAt: z.string(),
});

export const subscriptionUISchema = subscriptionSchema.omit({
  mollieCustomerId: true,
  mollieSubscriptionId: true,
  createdAt: true,
  updatedAt: true,
});

export type Subscription = z.infer<typeof subscriptionSchema>;
export type SubscriptionUI = z.infer<typeof subscriptionUISchema>;

export const planLimitsSchema = z.object({
  plan: z.enum(["free", "pro", "starter"]).nullable(),
  maxEventsPerYear: z.number().int().nullable(),
  maxRegistrationsPerEvent: z.number().int().nullable(),
  maxProductsPerEvent: z.number().int().nullable(),
  maxFormFields: z.number().int().nullable(),
  maxAdmins: z.number().int().nullable(),
  brandingRequired: z.boolean(),
  customDomainAllowed: z.boolean(),
  apiAccess: z.boolean(),
  advancedAnalytics: z.boolean(),
  promoCodes: z.boolean(),
  automatedEmails: z.boolean(),
});

export type PlanLimits = z.infer<typeof planLimitsSchema>;
