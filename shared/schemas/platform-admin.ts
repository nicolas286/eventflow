import { z } from "zod";

const isoDateSchema = z.iso.datetime({ offset: true });
const nullableIsoDateSchema = isoDateSchema.nullable();
const moneySchema = z.number().int();

export const platformActionSchema = z.enum([
  "settings.registrations.set",
  "announcements.publish",
  "announcements.retire",
  "communications.email.send",
  "organizations.onboard",
  "organizations.status",
  "organizations.plan",
  "organizations.owner",
  "admins.grant",
  "admins.revoke",
  "invitations.authorize",
]);

export const platformAccessSchema = z.object({
  isPlatformAdmin: z.boolean(),
  sessionActive: z.boolean(),
  aal: z.enum(["aal1", "aal2"]),
  mfaRequired: z.boolean(),
});

export const platformStepUpRequestSchema = z
  .object({
    action: platformActionSchema,
    targetId: z.string().trim().min(1).max(320),
  })
  .strict();

export const platformStepUpResponseSchema = z.object({
  token: z.string().min(32).max(512),
  expiresAt: isoDateSchema,
});

export const platformOverviewSchema = z.object({
  periodDays: z.number().int().min(7).max(365),
  updatedAt: isoDateSchema,
  organizations: z.object({
    total: z.number().int().nonnegative(),
    new7Days: z.number().int().nonnegative(),
    new30Days: z.number().int().nonnegative(),
    new90Days: z.number().int().nonnegative(),
    byStatus: z.object({
      trial: z.number().int().nonnegative(),
      active: z.number().int().nonnegative(),
      suspended: z.number().int().nonnegative(),
    }),
    byPlan: z.object({
      free: z.number().int().nonnegative(),
      starter: z.number().int().nonnegative(),
      pro: z.number().int().nonnegative(),
    }),
    incomplete: z.number().int().nonnegative(),
  }),
  activity: z.object({
    eventsTotal: z.number().int().nonnegative(),
    eventsPublished: z.number().int().nonnegative(),
    eventsUpcoming: z.number().int().nonnegative(),
    eventsCreatedPeriod: z.number().int().nonnegative(),
    ordersPeriod: z.number().int().nonnegative(),
    participantsPeriod: z.number().int().nonnegative(),
    ticketsPeriod: z.number().int().nonnegative(),
    activeOrganizations: z.number().int().nonnegative(),
    activeOrganizationsDefinition: z.string(),
  }),
  orders: z.object({
    paid: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    expired: z.number().int().nonnegative(),
    cancelledOrRefunded: z.number().int().nonnegative(),
  }),
  revenue: z.object({
    eventflowRevenueCents: moneySchema,
    gmvCents: moneySchema,
    refundsCents: moneySchema,
    currency: z.string().length(3),
  }),
  health: z.object({
    paymentIssues: z.number().int().nonnegative(),
    staleOrders: z.number().int().nonnegative(),
    emailFailures: z.number().int().nonnegative(),
    invoiceFailures: z.number().int().nonnegative(),
  }),
});

export const platformOrganizationSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: z.string(),
  status: z.enum(["trial", "active", "suspended"]),
  plan: z.enum(["free", "starter", "pro"]),
  planExpiresAt: nullableIsoDateSchema,
  paymentsProvider: z.string(),
  paymentsStatus: z.string(),
  createdAt: isoDateSchema,
  slug: z.string().nullable(),
  ownerEmail: z.email().nullable(),
  eventsCount: z.number().int().nonnegative(),
  ordersCount: z.number().int().nonnegative(),
  paidCents: moneySchema,
});

export const platformOrganizationsPageSchema = z.object({
  items: z.array(platformOrganizationSummarySchema),
  nextCursor: z.object({ createdAt: isoDateSchema, id: z.uuid() }).nullable(),
});

const platformMemberSchema = z.object({
  userId: z.uuid(),
  role: z.enum(["owner", "admin"]),
  email: z.email().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  createdAt: isoDateSchema,
});

export const platformOrganizationDetailSchema = z.object({
  organization: z.object({
    id: z.uuid(),
    name: z.string(),
    type: z.string(),
    status: z.enum(["trial", "active", "suspended"]),
    plan: z.enum(["free", "starter", "pro"]),
    planStartedAt: isoDateSchema,
    planExpiresAt: nullableIsoDateSchema,
    paymentsProvider: z.string(),
    paymentsStatus: z.string(),
    paymentsLiveReady: z.boolean(),
    createdAt: isoDateSchema,
    updatedAt: isoDateSchema,
  }),
  profile: z
    .object({
      slug: z.string(),
      displayName: z.string(),
      description: z.string().nullable(),
      publicEmail: z.string().nullable(),
      website: z.string().nullable(),
    })
    .nullable(),
  members: z.array(platformMemberSchema),
  subscription: z
    .object({
      provider: z.string(),
      status: z.string(),
      plan: z.string().nullable(),
      currentPeriodStart: nullableIsoDateSchema,
      currentPeriodEnd: nullableIsoDateSchema,
      billingDeferredUntil: nullableIsoDateSchema,
    })
    .nullable(),
  metrics: z.object({
    events: z.number().int().nonnegative(),
    orders: z.number().int().nonnegative(),
    participants: z.number().int().nonnegative(),
    paidCents: moneySchema,
  }),
  recentEvents: z.array(
    z.object({
      id: z.uuid(),
      slug: z.string(),
      title: z.string(),
      isPublished: z.boolean(),
      startsAt: nullableIsoDateSchema,
      createdAt: isoDateSchema,
    }),
  ),
});

export const platformAnnouncementSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  level: z.enum(["information", "warning", "maintenance"]),
  audience: z.enum(["organizer", "public", "both"]),
  status: z.enum(["draft", "published", "retired"]),
  startsAt: nullableIsoDateSchema,
  endsAt: nullableIsoDateSchema,
  publishedAt: nullableIsoDateSchema,
  retiredAt: nullableIsoDateSchema,
  createdBy: z.uuid(),
  updatedBy: z.uuid(),
  publishedBy: z.uuid().nullable(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export const platformConfigurationSchema = z.object({
  registrationsOpen: z.boolean(),
  registrationPublicMessage: z.string(),
  updatedAt: isoDateSchema,
  updatedBy: z.uuid().nullable(),
  announcements: z.array(platformAnnouncementSchema),
});

export const platformEmailCampaignRequestSchema = z
  .object({
    target: z.enum(["all", "organization"]),
    organizationId: z.uuid().nullable(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(160)
      .regex(/^[^\r\n]+$/),
    body: z.string().trim().min(1).max(10000),
    reason: z.string().trim().min(3).max(1000),
    idempotencyKey: z.uuid(),
  })
  .strict()
  .refine(
    (value) =>
      (value.target === "all" && value.organizationId === null) ||
      (value.target === "organization" && value.organizationId !== null),
    { message: "PLATFORM_EMAIL_TARGET_INVALID", path: ["organizationId"] },
  );

export const platformEmailCampaignResultSchema = z.object({
  id: z.uuid(),
  status: z.enum(["sending", "completed", "partial", "failed"]),
  recipientCount: z.number().int().min(1).max(100),
  sentCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
  createdAt: isoDateSchema,
  completedAt: nullableIsoDateSchema,
});

export const platformEmailCampaignSchema =
  platformEmailCampaignResultSchema.extend({
    target: z.enum(["all", "organization"]),
    organizationId: z.uuid().nullable(),
    organizationName: z.string().nullable(),
    subject: z.string(),
    reason: z.string(),
    actorEmail: z.email(),
  });

export const platformCommunicationsSchema = z.object({
  items: z.array(platformEmailCampaignSchema),
});

export const platformPublicConfigSchema = z.object({
  registrationsOpen: z.boolean(),
  registrationPublicMessage: z.string(),
  announcement: platformAnnouncementSchema
    .pick({
      id: true,
      title: true,
      body: true,
      level: true,
      audience: true,
      startsAt: true,
      endsAt: true,
    })
    .nullable(),
});

export const platformOnboardingRequestSchema = z
  .object({
    ownerEmail: z.email().trim().max(320),
    ownerFirstName: z.string().trim().min(1).max(80),
    ownerLastName: z.string().trim().min(1).max(80),
    organizationName: z.string().trim().min(3).max(120),
    organizationType: z.enum(["association", "person"]),
    plan: z.enum(["free", "starter", "pro"]),
    status: z.enum(["trial", "active", "suspended"]),
    trialDays: z.number().int().min(1).max(365),
    note: z.string().trim().max(1000).optional(),
    reason: z.string().trim().min(3).max(1000),
    idempotencyKey: z.uuid(),
  })
  .strict();

export const platformRegistrationSettingsRequestSchema = z
  .object({
    registrationsOpen: z.boolean(),
    registrationPublicMessage: z.string().trim().min(1).max(500),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const platformAnnouncementDraftRequestSchema = z
  .object({
    id: z.uuid().optional(),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(2000),
    level: z.enum(["information", "warning", "maintenance"]),
    audience: z.enum(["organizer", "public", "both"]),
    startsAt: isoDateSchema.nullable(),
    endsAt: isoDateSchema.nullable(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      !value.startsAt ||
      !value.endsAt ||
      Date.parse(value.endsAt) > Date.parse(value.startsAt),
    { message: "ANNOUNCEMENT_WINDOW_INVALID", path: ["endsAt"] },
  );

export const platformReasonSchema = z.string().trim().min(3).max(1000);

export const platformOrganizationStatusRequestSchema = z
  .object({
    status: z.enum(["trial", "active", "suspended"]),
    reason: platformReasonSchema,
  })
  .strict();

export const platformOrganizationPlanRequestSchema = z
  .object({
    plan: z.enum(["free", "starter", "pro"]),
    days: z.number().int().min(1).max(3650),
    reason: platformReasonSchema,
  })
  .strict();

export const platformOrganizationOwnerRequestSchema = z
  .object({
    ownerEmail: z.email().trim().max(320),
    reason: platformReasonSchema,
  })
  .strict();

export const platformAdminAccessRequestSchema = z
  .object({
    email: z.email().trim().max(320),
    note: z.string().trim().max(1000).optional(),
    reason: platformReasonSchema,
  })
  .strict();

export const platformSimpleMutationSchema = z
  .object({ reason: platformReasonSchema })
  .strict();

export const platformAuditSchema = z.object({
  items: z.array(
    z.object({
      id: z.number().int().positive(),
      actorUserId: z.uuid().nullable(),
      actorEmail: z.string().nullable(),
      action: z.string(),
      targetType: z.string(),
      targetId: z.string().nullable(),
      outcome: z.enum(["success", "failure"]),
      reason: z.string().nullable(),
      metadata: z.record(z.string(), z.unknown()),
      createdAt: isoDateSchema,
    }),
  ),
  nextCursorCreatedAt: nullableIsoDateSchema,
});

export const platformFinanceSchema = z.object({
  subscriptions: z.array(
    z.object({
      orgId: z.uuid(),
      organizationName: z.string(),
      provider: z.string(),
      plan: z.string().nullable(),
      status: z.string(),
      currentPeriodStart: nullableIsoDateSchema,
      currentPeriodEnd: nullableIsoDateSchema,
      updatedAt: isoDateSchema,
    }),
  ),
  invoices: z.array(
    z.object({
      id: z.uuid(),
      orgId: z.uuid(),
      organizationName: z.string(),
      number: z.string().nullable(),
      status: z.string(),
      totalCents: moneySchema,
      currency: z.string().length(3),
      issuedAt: nullableIsoDateSchema,
      dueAt: nullableIsoDateSchema,
      paidAt: nullableIsoDateSchema,
      createdAt: isoDateSchema,
    }),
  ),
  paymentTotals: z.object({
    paidCents: moneySchema,
    refundedCents: moneySchema,
    failedCount: z.number().int().nonnegative(),
    pendingCount: z.number().int().nonnegative(),
  }),
});

const platformOperationBaseSchema = z.object({
  orgId: z.uuid(),
  organizationName: z.string(),
});

export const platformOperationsSchema = z.object({
  staleOrders: z.array(
    platformOperationBaseSchema.extend({
      id: z.uuid(),
      status: z.string(),
      totalCents: moneySchema,
      createdAt: isoDateSchema,
    }),
  ),
  emailFailures: z.array(
    platformOperationBaseSchema.extend({
      id: z.uuid(),
      error: z.string(),
      updatedAt: isoDateSchema,
    }),
  ),
  invoiceFailures: z.array(
    platformOperationBaseSchema.extend({
      invoiceId: z.uuid(),
      status: z.string(),
      errorCode: z.string().nullable(),
      errorMessage: z.string().nullable(),
      updatedAt: isoDateSchema,
    }),
  ),
  paymentConnections: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      paymentsProvider: z.string(),
      paymentsStatus: z.string(),
      paymentsLiveReady: z.boolean(),
      paymentsAccountUpdatedAt: nullableIsoDateSchema,
      updatedAt: isoDateSchema,
    }),
  ),
});

export const platformAdminsSchema = z.object({
  items: z.array(
    z.object({
      userId: z.uuid(),
      email: z.email(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      grantedAt: isoDateSchema,
      grantedBy: z.uuid().nullable(),
      revokedAt: nullableIsoDateSchema,
      note: z.string().nullable(),
    }),
  ),
});

export type PlatformAction = z.infer<typeof platformActionSchema>;
export type PlatformAccess = z.infer<typeof platformAccessSchema>;
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;
export type PlatformOrganizationsPage = z.infer<
  typeof platformOrganizationsPageSchema
>;
export type PlatformOrganizationDetail = z.infer<
  typeof platformOrganizationDetailSchema
>;
export type PlatformConfiguration = z.infer<typeof platformConfigurationSchema>;
export type PlatformEmailCampaignRequest = z.infer<
  typeof platformEmailCampaignRequestSchema
>;
export type PlatformEmailCampaignResult = z.infer<
  typeof platformEmailCampaignResultSchema
>;
export type PlatformCommunications = z.infer<
  typeof platformCommunicationsSchema
>;
export type PlatformPublicConfig = z.infer<typeof platformPublicConfigSchema>;
export type PlatformOnboardingRequest = z.infer<
  typeof platformOnboardingRequestSchema
>;
export type PlatformFinance = z.infer<typeof platformFinanceSchema>;
export type PlatformOperations = z.infer<typeof platformOperationsSchema>;
export type PlatformAdmins = z.infer<typeof platformAdminsSchema>;
