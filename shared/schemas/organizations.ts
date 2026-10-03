import { z } from "zod";
import {
  membershipSchema,
  organizationProfileSchema,
  organizationSchema,
  planLimitsSchema,
  profileSchema,
  subscriptionUISchema,
} from "./organization-data.ts";

export const dashboardRequestSchema = z.object({ orgId: z.uuid().optional() })
  .strict();
export const dashboardBootstrapSchema = z.object({
  profile: profileSchema,
  membership: membershipSchema.nullable(),
  organization: organizationSchema.nullable(),
  organizationProfile: organizationProfileSchema.nullable(),
  subscription: subscriptionUISchema.nullable(),
  latestOpenInvoice: z.object({
    id: z.uuid(),
    number: z.string(),
    status: z.literal("issued"),
    issuedAt: z.string(),
    dueAt: z.string(),
    totalCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
    paymentReference: z.string(),
  }).nullable().optional(),
  planLimits: planLimitsSchema,
});
export type DashboardBootstrap = z.infer<typeof dashboardBootstrapSchema>;

export const createOrganizationRequestSchema = z.object({
  type: organizationSchema.shape.type,
  name: z.string().trim().pipe(organizationSchema.shape.name),
}).strict();
export const createOrganizationResponseSchema = z.uuid();
export const updateOrganizationRequestSchema = z.object({
  orgId: z.uuid(),
  type: organizationSchema.shape.type.optional(),
  name: z.string().trim().pipe(organizationSchema.shape.name).optional(),
  description: organizationProfileSchema.shape.description.optional(),
  publicEmail: organizationProfileSchema.shape.publicEmail.optional(),
  phone: organizationProfileSchema.shape.phone.optional(),
  website: organizationProfileSchema.shape.website.optional(),
  emailReminderDaysBefore: organizationProfileSchema.shape
    .emailReminderDaysBefore.optional(),
}).strict().refine(
  (v) => Object.keys(v).some((k) => k !== "orgId"),
  "EMPTY_PATCH",
);
export const updateOrganizationResponseSchema = z.object({
  orgId: z.uuid(),
  type: organizationSchema.shape.type,
  name: organizationSchema.shape.name,
  status: z.enum(["trial", "active", "suspended"]),
  paymentStatus: organizationSchema.shape.paymentsStatus,
  paymentsLiveReady: z.boolean(),
  profile: organizationProfileSchema.pick({
    slug: true,
    displayName: true,
    description: true,
    publicEmail: true,
    phone: true,
    website: true,
    emailReminderDaysBefore: true,
  }),
});
export const profilePatchSchema = profileSchema.omit({
  userId: true,
  createdAt: true,
  updatedAt: true,
  stripeConnectAllowed: true,
  country: true,
}).partial().strict();
export const updateProfileRequestSchema = z.object({
  userId: z.uuid(),
  patch: profilePatchSchema,
}).strict();
export const brandingSchema = organizationProfileSchema.pick({
  orgId: true,
  displayName: true,
  primaryColor: true,
  logoUrl: true,
  defaultEventBannerUrl: true,
  widgetBg: true,
  widgetCard: true,
  widgetText: true,
  widgetButton: true,
});
export const updateBrandingRequestSchema = z.object({
  orgId: z.uuid(),
  patch: brandingSchema.omit({ orgId: true }).partial().strict(),
}).strict();
export const sellerIdentityRequestSchema = z.object({
  orgId: z.uuid(),
  legalName: z.string().trim().min(2).max(200),
  address: z.string().trim().min(8).max(500),
  businessNumber: z.string().trim().max(100).nullable(),
  sellerType: z.enum(["professional", "non_professional"]),
  phone: z.string().trim().min(6).max(32),
}).strict();
export const acceptAgreementsRequestSchema = z.object({
  orgId: z.uuid(),
  connectVersion: z.literal("2026-10-01"),
  dpaVersion: z.literal("2026-10-01"),
  platformTermsVersion: z.literal("2026-10-01"),
  privacyVersion: z.literal("2026-10-01"),
}).strict();
export const mutationSuccessSchema = z.object({ success: z.literal(true) })
  .strict();
