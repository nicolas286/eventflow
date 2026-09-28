import { z } from "zod";

export const startSubscriptionPayloadSchema = z.object({
  orgId: z.uuid(),
  plan: z.enum(["starter", "pro"]),
  promoCode: z.string().trim().min(1).max(100).nullable().optional(),
});

export type StartSubscriptionPayload = z.infer<
  typeof startSubscriptionPayloadSchema
>;

export const startSubscriptionResponseSchema = z.object({
  ok: z.literal(true),
  action: z.literal("invoice"),
  provider: z.literal("manual"),
  orgId: z.string().uuid(),
  plan: z.enum(["starter", "pro"]),
  status: z.literal("active"),
  invoiceId: z.string().uuid(),
  invoiceNumber: z.string().min(1),
  dueAt: z.string(),
  currentPeriodEnd: z.string(),
  reused: z.boolean(),
  promoApplied: z.boolean(),
  discountPercent: z.number().int().min(0).max(100).nullable(),
  billingPriceValue: z.string(),
  warnings: z.array(z.string()),
});

export type StartSubscriptionResponse = z.infer<
  typeof startSubscriptionResponseSchema
>;
