import { z } from "zod";

export const stripeConnectInputSchema = z.object({
  orgId: z.uuid(),
});

export const stripeConnectStartResultSchema = z.object({
  ok: z.literal(true),
  url: z.url(),
});

export const stripeConnectStatusResultSchema = z.object({
  ok: z.literal(true),
  status: z.enum(["pending", "connected"]),
  detailsSubmitted: z.boolean(),
  chargesEnabled: z.boolean(),
  payoutsEnabled: z.boolean(),
});

export type StripeConnectInput = z.infer<typeof stripeConnectInputSchema>;
export type StripeConnectStatus = z.infer<
  typeof stripeConnectStatusResultSchema
>;
