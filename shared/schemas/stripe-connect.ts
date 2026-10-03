import { z } from "zod";

export const stripeConnectInputSchema = z.object({
  // Preserve the existing server UUID contract (versions 1-5, RFC variant).
  orgId: z.string().regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  ),
});

export const stripeConnectStartResultSchema = z.object({
  ok: z.literal(true),
  url: z.url(),
});

export const stripeConnectStatusResultSchema = z.object({
  ok: z.literal(true),
  status: z.enum(["pending", "connected", "requires_migration"]),
  detailsSubmitted: z.boolean(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
  complianceVerified: z.boolean(),
  accountType: z.string().nullable(),
  configurationSupported: z.boolean(),
  requirementsDisabledReason: z.string().nullable(),
  requirementsCurrentlyDue: z.array(z.string()),
});

export type StripeConnectInput = z.infer<typeof stripeConnectInputSchema>;
export type StripeConnectStatus = z.infer<
  typeof stripeConnectStatusResultSchema
>;
