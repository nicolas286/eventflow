import { z } from "zod";

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
