import { z } from "zod";
import { promoCodeBaseSchema } from "./promo-code-data.ts";
export {
  promoCodeBaseSchema, promoCodeSchema, dbPromoCodeBaseSchema, dbPromoCodeSchema,
  type PromoCode, type DbPromoCode,
} from "./promo-code-data.ts";

export const promoCodeValueSchema = z.string().trim().toUpperCase().pipe(z.string().min(1).max(20));
const promoDateInputSchema = z.iso.datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), "Date invalide")
  .nullable();
const promoBusinessSchema = promoCodeBaseSchema.pick({
  discountPercent: true, discountCents: true, maxUses: true, isActive: true,
}).extend({
  code: promoCodeValueSchema,
  startsAt: promoDateInputSchema,
  endsAt: promoDateInputSchema,
}).strict();

function exactlyOneDiscount(value: { discountPercent?: number | null; discountCents?: number | null }) {
  return (value.discountPercent !== null && value.discountPercent !== undefined && value.discountCents === null)
    || (value.discountPercent === null && value.discountCents !== null && value.discountCents !== undefined);
}
function datesAreValid(value: { startsAt?: string | null; endsAt?: string | null }) {
  return !value.startsAt || !value.endsAt || Date.parse(value.startsAt) < Date.parse(value.endsAt);
}

export const promoListRequestSchema = z.object({ eventId: z.uuid() }).strict();
export const promoCreateRequestSchema = promoBusinessSchema.extend({
  orgId: z.uuid(), eventId: z.uuid(),
  maxUses: promoBusinessSchema.shape.maxUses.default(null),
  startsAt: promoDateInputSchema.default(null),
  endsAt: promoDateInputSchema.default(null),
  isActive: z.boolean().default(true),
}).strict().refine(exactlyOneDiscount, {
  message: "PROMO_CODE_REQUIRES_EXACTLY_ONE_DISCOUNT_TYPE", path: ["discountPercent"],
}).refine(datesAreValid, {
  message: "PROMO_CODE_INVALID_DATE_RANGE", path: ["endsAt"],
});

const promoOptionalPatchSchema = promoBusinessSchema.partial().strict().refine((patch) => {
  const touchesDiscount = patch.discountPercent !== undefined || patch.discountCents !== undefined;
  return !touchesDiscount || exactlyOneDiscount(patch);
}, {
  message: "PROMO_CODE_REQUIRES_EXACTLY_ONE_DISCOUNT_TYPE", path: ["discountPercent"],
}).refine(datesAreValid, {
  message: "PROMO_CODE_INVALID_DATE_RANGE", path: ["endsAt"],
});
export const promoUpdatePatchSchema = promoOptionalPatchSchema.refine(
  (patch) => Object.values(patch).some((value) => value !== undefined),
  { message: "PROMO_CODE_PATCH_EMPTY" },
);
export const promoUpdateRequestSchema = z.object({ promoCodeId: z.uuid(), patch: promoUpdatePatchSchema }).strict();
export const promoUpdateOrReadRequestSchema = z.object({ promoCodeId: z.uuid(), patch: promoOptionalPatchSchema }).strict();
export const promoReadRequestSchema = z.object({ promoCodeId: z.uuid() }).strict();
export const promoDeleteRequestSchema = z.object({ id: z.uuid() }).strict();
export const promoMutationSuccessSchema = z.object({ success: z.literal(true) }).strict();

// Preserve the historical frontend schema with its separate legacy identifier.
export const updatePromoCodeInputSchema = z.object({ id: z.uuid(), patch: promoUpdatePatchSchema }).strict();
export type CreatePromoCodeInput = z.input<typeof promoCreateRequestSchema>;
export type UpdatePromoCodePatch = z.input<typeof promoUpdatePatchSchema>;
export type UpdatePromoCodeInput = z.input<typeof updatePromoCodeInputSchema>;
export type DeletePromoCodeInput = z.input<typeof promoDeleteRequestSchema>;
