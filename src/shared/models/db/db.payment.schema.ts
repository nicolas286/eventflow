import { z } from "zod";

export const paymentSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  provider: z.enum(["mollie", "stripe", "offline"]),
  providerPaymentId: z
    .string()
    .min(3, "L'id paiement est trop court")
    .max(100, "L'id paiement est trop long"),
  providerAccountId: z.string().max(100).optional().nullable(),
  providerCheckoutSessionId: z.string().max(100).optional().nullable(),
  amountCents: z
    .number()
    .int()
    .min(0, "Le montant doit être positif ou nul")
    .max(10000000, "Le montant est trop élevé"),
  currency: z.string().length(3, "Le code devise doit faire 3 caractères"),
  status: z.enum([
    "created",
    "pending",
    "failed",
    "expired",
    "open",
    "authorized",
    "paid",
    "canceled",
  ]),
  isRefund: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  processedAt: z.string().optional().nullable(),
  raw: z.unknown().nullable().optional(),
  type: z.enum(["payment", "refund"]),
  parentPaymentId: z.uuid().optional().nullable(),
});

export const paymentUISchema = paymentSchema.omit({ raw: true });

export const paymentsSchema = z.array(paymentSchema);
export const paymentsUISchema = z.array(paymentUISchema);

export type Payment = z.infer<typeof paymentSchema>;
export type PaymentUI = z.infer<typeof paymentUISchema>;
export type Payments = z.infer<typeof paymentsSchema>;
export type PaymentsUI = z.infer<typeof paymentsUISchema>;
