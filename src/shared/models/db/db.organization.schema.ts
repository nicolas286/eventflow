import { z } from "zod";

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
