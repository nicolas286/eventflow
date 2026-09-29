import { z } from "zod";

export const orderSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  eventId: z.uuid(),
  currency: z.string().length(3, "Le code devise doit faire 3 caractères"),
  totalCents: z
    .number()
    .int()
    .min(0, "Le total doit être positif ou nul")
    .max(1000000000, "Le total est trop élevé"),
  paidCents: z
    .number()
    .int()
    .min(0, "Le montant payé doit être positif ou nul")
    .max(1000000000, "Le montant payé est trop élevé"),
  buyerEmail: z
    .email("L'email de l'acheteur est invalide")
    .max(254, "L'email de l'acheteur est trop long")
    .nullable()
    .optional(),
  buyerName: z
    .string()
    .min(2, "Le nom de l'acheteur est trop court")
    .max(120, "Le nom de l'acheteur est trop long")
    .nullable()
    .optional(),
  bookingToken: z
    .string()
    .min(32, "Le token de réservation est trop court")
    .max(128, "Le token de réservation est trop long"),
  canceledAt: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: z.enum([
    "pending",
    "awaiting_payment",
    "partially_paid",
    "expired",
    "canceled",
    "paid",
    "refunded",
  ]),
  expiresAt: z.string().nullable().optional(),
  confirmedAt: z.string().nullable().optional(),
  detailsCompletedAt: z.string().nullable().optional(),
  depositDueCentsSnapshot: z
    .number()
    .int()
    .min(0, "Le montant de l'acompte doit être positif ou nul")
    .max(1000000000, "Le montant de l'acompte est trop élevé"),
  buyerPhone: z
    .string()
    .min(6, "Le téléphone de l'acheteur est trop court")
    .max(20, "Le téléphone de l'acheteur est trop long")
    .nullable()
    .optional(),
  buyerIsAttendee: z.boolean(),
});

export const ordersSchema = z.array(orderSchema);

export type Order = z.infer<typeof orderSchema>;
export type Orders = z.infer<typeof ordersSchema>;
