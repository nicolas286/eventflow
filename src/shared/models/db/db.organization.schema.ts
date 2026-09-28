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
  paymentsProvider: z.enum(["mollie", "stripe"]),
  paymentsStatus: z.enum(["not_connected", "pending", "connected", "revoked"]),
  paymentsLiveReady: z.boolean(),
  paymentsDetailsSubmitted: z.boolean().optional(),
  stripeConnectedAccountId: z.string().nullable().optional(),
  stripeDetailsSubmitted: z.boolean().optional(),
  stripeChargesEnabled: z.boolean().optional(),
  stripePayoutsEnabled: z.boolean().optional(),
  stripeMigrationRequired: z.boolean().optional(),
  paymentsAccountUpdatedAt: z.string().nullable().optional(),
  plan: z.enum(["free", "pro", "starter"]),
  planStartedAt: z.string(),
  planExpiresAt: z.string().nullable(),
});

export type Organization = z.infer<typeof organizationSchema>;
