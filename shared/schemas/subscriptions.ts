import { z } from "zod";

export const startSubscriptionPayloadSchema = z
  .object({
    orgId: z.uuid(),
    plan: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.enum(["starter", "pro"])),
    promoCode: z
      .string()
      .trim()
      .toUpperCase()
      .min(1)
      .max(100)
      .nullable()
      .optional(),
  })
  .strict();

export type StartSubscriptionPayload = z.infer<
  typeof startSubscriptionPayloadSchema
>;

export function parseStartSubscriptionPayload(input: unknown) {
  return startSubscriptionPayloadSchema.safeParse(input);
}
const sharedPricingFields = {
  promoApplied: z.boolean().optional(),
  discountPercent: z.number().int().min(0).max(100).nullable().optional(),
  billingPriceValue: z.string().optional(),
};

const sharedDebugFields = {
  returnBaseUrl: z.string().optional(),
  canceledPrevious: z.boolean().optional(),
};

/* ------------------------------------------------------------------ */
/* Response                                                           */
/* ------------------------------------------------------------------ */

export const startSubscriptionResponseSchema = z.union([
  z.object({
    ok: z.literal(true),
    action: z.literal("sub_created"),
    orgId: z.string().uuid(),
    plan: z.enum(["starter", "pro"]),
    mollieCustomerId: z.string().nullable().optional(),
    mollieSubscriptionId: z.string().nullable().optional(),
    status: z.string().optional(),
    currentPeriodEnd: z.string().nullable().optional(),
    reused: z.boolean().optional(),
    ...sharedPricingFields,
    ...sharedDebugFields,
  }),

  z.object({
    ok: z.literal(true),
    action: z.literal("checkout"),
    orgId: z.string().uuid(),
    plan: z.enum(["starter", "pro"]),
    mollieCustomerId: z.string(),
    checkoutUrl: z.string().url(),
    paymentId: z.string(),
    ...sharedPricingFields,
    ...sharedDebugFields,
  }),

  z.object({
    ok: z.literal(false),
    warning: z.literal("subscription_created_but_db_not_updated"),
    details: z.string(),
    mollieCustomerId: z.string().nullable().optional(),
    mollieSubscriptionId: z.string().nullable().optional(),
    status: z.string().optional(),
    canceledPrevious: z.boolean().optional(),
  }),
]);

export type StartSubscriptionResponse = z.infer<
  typeof startSubscriptionResponseSchema
>;
