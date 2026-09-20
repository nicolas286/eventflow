import { z } from "zod";

export const orderIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
export const bookingTokenSchema = z.string().trim().min(1).max(2048);
export const orderPublicSchema = z.object({
  id: z.uuid(),
  status: z.enum(["open", "pending", "paid", "failed", "canceled", "cancelled", "expired", "awaiting_payment", "partially_paid"]),
  totalCents: z.number().int().nullable(),
  currency: z.string().nullable(),
  paymentStatus: z.string().nullable(),
});
export type OrderPublicResponse = z.infer<typeof orderPublicSchema>;
