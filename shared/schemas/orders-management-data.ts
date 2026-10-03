import { z } from "zod";

export const orderSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  eventId: z.uuid(),
  currency: z.string().length(3, "Le code devise doit faire 3 caractÃ¨res"),
  totalCents: z
    .number()
    .int()
    .min(0, "Le total doit Ãªtre positif ou nul")
    .max(1000000000, "Le total est trop Ã©levÃ©"),
  paidCents: z
    .number()
    .int()
    .min(0, "Le montant payÃ© doit Ãªtre positif ou nul")
    .max(1000000000, "Le montant payÃ© est trop Ã©levÃ©"),
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
    .min(32, "Le token de rÃ©servation est trop court")
    .max(128, "Le token de rÃ©servation est trop long"),
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
    .min(0, "Le montant de l'acompte doit Ãªtre positif ou nul")
    .max(1000000000, "Le montant de l'acompte est trop Ã©levÃ©"),
  buyerPhone: z
    .string()
    .min(6, "Le tÃ©lÃ©phone de l'acheteur est trop court")
    .max(20, "Le tÃ©lÃ©phone de l'acheteur est trop long")
    .nullable()
    .optional(),
  buyerIsAttendee: z.boolean(),
});

export const ordersSchema = z.array(orderSchema);

export type Order = z.infer<typeof orderSchema>;
export type Orders = z.infer<typeof ordersSchema>;

export const promoRedemptionUISchema = z
  .object({
    id: z.uuid(),
    promoCodeId: z.uuid(),
    code: z.string().nullable(),
    discountCents: z.number().int().min(0),
    createdAt: z.string(),
  })
  .nullable();

export const orderUISchema = orderSchema
  .omit({ bookingToken: true })
  .extend({
    publicId: z.string().optional(),

    discountCents: z.number().int().min(0).default(0),
    dueCents: z.number().int().min(0).default(0),
    promoRedemption: promoRedemptionUISchema.optional().default(null),
  });

export const ordersUISchema = z.object({
  limit: z.number().int().min(1).max(1000),
  offset: z.number().int().min(0),
  total: z.number().int().min(0),
  rows: z.array(orderUISchema),
});

export type PromoRedemptionUI = z.infer<typeof promoRedemptionUISchema>;
export type OrderUI = z.infer<typeof orderUISchema>;
export type OrdersUI = z.infer<typeof ordersUISchema>;
export const orderItemSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  productId: z.uuid().optional().nullable(),
  productNameSnapshot: z.string().min(2, "Le nom du produit est trop court")
    .max(80, "Le nom du produit est trop long"),
  unitPriceCentsSnapshot: z.number().int().min(
    0,
    "Le prix doit Ãªtre positif ou nul",
  ).max(10000000, "Le prix est trop Ã©levÃ©"),
  quantity: z.number().int().min(
    0,
    "La quantitÃ© en stock doit Ãªtre positive ou nulle",
  ).nullable().optional(),
  createdAt: z.string(),
});

export const orderItemsSchema = z.array(orderItemSchema);

export type OrderItem = z.infer<typeof orderItemSchema>;
export type OrderItems = z.infer<typeof orderItemsSchema>;
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
    .min(0, "Le montant doit Ãªtre positif ou nul")
    .max(10000000, "Le montant est trop Ã©levÃ©"),
  currency: z.string().length(3, "Le code devise doit faire 3 caractÃ¨res"),
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

export const attendeeSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  productId: z.uuid().nullable().optional(),
  productNameSnapshot: z.string().min(2, "Le nom du produit est trop court")
    .max(80, "Le nom du produit est trop long"),
  attendeeIndex: z.number().int().min(
    1,
    "L'index de l'attendee doit supÃ©rieur ou Ã©gal Ã  1",
  ).max(500, "L'index de l'attendee est trop grand"),
  createdAt: z.string(),
  status: z.enum(["reserved", "confirmed", "cancelled", "expired"]),
  confirmedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  detailsCompletedAt: z.string().nullable().optional(),
  canceledAt: z.string().nullable().optional(),
});

export const attendeesSchema = z.array(attendeeSchema);

export type Attendee = z.infer<typeof attendeeSchema>;
export type Attendees = z.infer<typeof attendeesSchema>;
export const attendeeAnswersSchema = z.object({
  id: z.uuid(),
  attendeeId: z.uuid(),
  fieldKeySnapshot: z.string().min(2, "La clÃ© est trop courte").max(
    100,
    "La clÃ© est trop longue",
  ),
  fieldTypeSnapshot: z.enum([
    "text",
    "textarea",
    "email",
    "number",
    "select",
    "checkbox",
    "radio",
    "date",
    "country",
    "phone",
  ]),
  fieldLabelSnapshot: z.string().min(1, "Le label est trop court").max(
    200,
    "Le label est trop long",
  ),
  value: z.string().trim().max(10000).nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const attendeesAnswersSchema = z.array(attendeeAnswersSchema);

export type AttendeeAnswers = z.infer<typeof attendeeAnswersSchema>;
export type AttendeesAnswers = z.infer<typeof attendeesAnswersSchema>;
export const eventAdminOrdersViewSchema = z.object({
  orders: ordersUISchema,
  orderItems: orderItemsSchema,
  payments: paymentsUISchema,
  attendees: attendeesSchema,
  attendeeAnswers: attendeesAnswersSchema,
});

export type EventAdminOrdersView = z.infer<typeof eventAdminOrdersViewSchema>;
export const eventParticipantsExportSchema = z.object({
  orders: z.object({
    rows: z.array(orderUISchema),
  }),
  orderItems: z.array(orderItemSchema),
  attendees: z.array(attendeeSchema),
  attendeeAnswers: z.array(attendeeAnswersSchema),
});

export type EventParticipantsExportData = z.infer<
  typeof eventParticipantsExportSchema
>;
/* ---------------- shared primitives ---------------- */

const uuidSchema = z.uuid();

const isoDateSchema = z.string().datetime({ offset: true });

const nullableIsoDateSchema = z.union([
  isoDateSchema,
  z.null(),
]);

/* ---------------- ticket row ---------------- */

export const adminEventTicketRowSchema = z
  .object({
    id: uuidSchema,
    orderId: uuidSchema,
    orderItemId: uuidSchema,

    productId: uuidSchema,
    productNameSnapshot: z.string().trim().min(1),
    unitPriceCentsSnapshot: z.number().int().min(0),

    ticketIndex: z.number().int().min(1),
    reference: z.string().trim().min(1),
    qrToken: z.string().trim().min(1),

    status: z.string().trim().min(1),
    checkedInAt: nullableIsoDateSchema,
    createdAt: isoDateSchema,

    createsAttendees: z.boolean(),
    admitsCount: z.number().int().min(1),

    orderCreatedAt: isoDateSchema,
    buyerEmail: z.string().trim().email().nullable().or(z.literal("")),

    attendeeSummaryLines: z.array(z.string().trim().min(1)).default([]),
  })
  .strict();

export type AdminEventTicketRow = z.infer<typeof adminEventTicketRowSchema>;

/* ---------------- paginated payload ---------------- */

export const adminEventTicketsPayloadSchema = z
  .object({
    limit: z.number().int().min(1).max(1000),
    offset: z.number().int().min(0),
    total: z.number().int().min(0),
    rows: z.array(adminEventTicketRowSchema),
  })
  .strict();

export type AdminEventTicketsPayload = z.infer<
  typeof adminEventTicketsPayloadSchema
>;

/* ---------------- rpc response ---------------- */

export const getEventTicketsAdminResponseSchema = z
  .object({
    tickets: adminEventTicketsPayloadSchema,
  })
  .strict();

export type GetEventTicketsAdminResponse = z.infer<
  typeof getEventTicketsAdminResponseSchema
>;
/**
 * RPC: admin_delete_order
 * Expected jsonb:
 * {
 *   deleted_order_id: uuid,
 *   released: {
 *     reserved_units: number,
 *     sold_units: number
 *   }
 * }
 */

export const adminDeleteOrderReleasedSchema = z
  .object({
    reserved_units: z.number().int().nonnegative(),
    sold_units: z.number().int().nonnegative(),
  })
  .strict();

export const adminDeleteOrderResultSchema = z
  .object({
    deleted_order_id: z.uuid(),
    released: adminDeleteOrderReleasedSchema.optional(),
  })
  .strict();

export type AdminDeleteOrderResult = z.infer<
  typeof adminDeleteOrderResultSchema
>;

export const adminUpdateOrderAttendeeInputSchema = z.object({
  attendeeId: z.uuid(),
  orgId: z.uuid().optional(),
  eventId: z.uuid().optional(),
  attendee: z.object({
    answers: z.array(
      z.object({
        fieldKey: z.string().min(1).max(100).optional(),
        eventFormFieldId: z.uuid().optional(),
        valueText: z.string().max(10000).optional(),
        valueInt: z.number().int().optional(),
        valueBool: z.boolean().optional(),
        valueDate: z.string().max(100).optional(),
        value: z.unknown().optional(),
      }).strict().refine((v) => !!v.fieldKey || !!v.eventFormFieldId),
    ).max(200),
  }).strict(),
}).strict();

export type AdminUpdateOrderAttendeeInput = z.infer<
  typeof adminUpdateOrderAttendeeInputSchema
>;

export const adminUpdateOrderAttendeeResultSchema = z.object({
  attendeeId: z.uuid(),
  updatedAnswersCount: z.number().int().min(0),
});

export type AdminUpdateOrderAttendeeResult = z.infer<
  typeof adminUpdateOrderAttendeeResultSchema
>;
