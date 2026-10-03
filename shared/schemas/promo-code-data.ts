import { z } from "zod";

export const promoCodeBaseSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  eventId: z.uuid(),
  code: z.string().trim().min(1).max(20),
  discountPercent: z.number().int().min(1).max(100).nullable(),
  discountCents: z.number().int().min(1).max(100_000).nullable(),
  maxUses: z.number().int().min(1).max(99_999).nullable(),
  usedCount: z.number().int().min(0).max(99_999),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const promoCodeSchema = promoCodeBaseSchema.refine(
  (value) =>
    (value.discountPercent !== null && value.discountCents === null) ||
    (value.discountPercent === null && value.discountCents !== null),
  { message: "PROMO_CODE_REQUIRES_EXACTLY_ONE_DISCOUNT_TYPE", path: ["discountPercent"] },
);

export const dbPromoCodeBaseSchema = promoCodeBaseSchema;
export const dbPromoCodeSchema = promoCodeSchema;
export type DbPromoCode = z.infer<typeof promoCodeSchema>;
export type PromoCode = DbPromoCode;
