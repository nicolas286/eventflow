import { z } from "zod";
import { bankTransferInstructionsSchema } from "./bank-transfer.ts";

export const orderIdSchema = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
export const bookingTokenSchema = z.string().trim().min(1).max(2048);
export const orderPublicItemSchema = z.object({
  name: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  unitPriceCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
  currency: z.string().trim().min(1),
});
export const orderPublicSchema = z.object({
  id: z.uuid(),
  status: z.enum([
    "open",
    "pending",
    "paid",
    "failed",
    "canceled",
    "cancelled",
    "expired",
    "awaiting_payment",
    "partially_paid",
    "refunded",
  ]),
  totalCents: z.number().int().nullable(),
  currency: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  paymentMethod: z.enum(["stripe", "bank_transfer"]).nullable().optional(),
  bankTransfer: bankTransferInstructionsSchema.nullable().optional(),
  orgSlug: z.string().trim().min(1).nullable().optional(),
  eventSlug: z.string().trim().min(1).nullable().optional(),
  buyerEmail: z.email().nullable().optional(),
  items: z.array(orderPublicItemSchema).optional(),
});
export type OrderPublicResponse = z.infer<typeof orderPublicSchema>;
