import { z } from "zod";
import { eventProductSchema } from "./event-products-data.ts";
export { eventProductSchema, type EventProduct } from "./event-products-data.ts";

const productCurrencySchema = z.string().trim().toUpperCase().pipe(z.literal("EUR"));
const productBusinessSchema = eventProductSchema.omit({
  id: true, eventId: true, reservedQty: true, soldQty: true,
  createdAt: true, updatedAt: true,
}).extend({
  name: z.string().trim()
    .min(2, "Le nom du produit est trop court")
    .max(80, "Le nom du produit est trop long"),
  currency: productCurrencySchema.optional(),
}).strict();

export const productCreateRequestSchema = productBusinessSchema.extend({
  eventId: z.uuid(),
  currency: productCurrencySchema.default("EUR"),
  description: productBusinessSchema.shape.description.default(null),
  stockQty: productBusinessSchema.shape.stockQty.default(null),
  isActive: productBusinessSchema.shape.isActive.default(true),
  sortOrder: productBusinessSchema.shape.sortOrder.default(1),
  createsAttendees: productBusinessSchema.shape.createsAttendees.default(true),
  attendeesPerUnit: productBusinessSchema.shape.attendeesPerUnit.default(1),
  isGatekeeper: productBusinessSchema.shape.isGatekeeper.default(false),
  closeEventWhenSoldOut: productBusinessSchema.shape.closeEventWhenSoldOut.default(false),
}).strict();
export const productUpdatePatchSchema = productBusinessSchema.partial().strict();
export const productUpdateRequestSchema = z.object({
  productId: z.uuid(),
  patch: productUpdatePatchSchema.refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Aucun champ à mettre à jour",
  ),
}).strict();
export const productReadRequestSchema = z.object({ productId: z.uuid() }).strict();
export const productDeleteRequestSchema = z.object({ id: z.uuid() }).strict();
export const productDeleteResponseSchema = z.object({ success: z.literal(true) }).strict();

export type CreateEventProductInput = z.input<typeof productCreateRequestSchema>;
export type UpdateEventProductPatch = z.input<typeof productUpdatePatchSchema>;
export type DeleteEventProductInput = z.input<typeof productDeleteRequestSchema>;
