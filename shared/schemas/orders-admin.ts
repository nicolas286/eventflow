import { z } from "zod";

/* ---------------- Primitives ---------------- */

export const uuidSchema = z.uuid();

export const buyerEmailSchema = z.email().trim().max(254);
export const buyerNameSchema = z.string().trim().min(2).max(120);
export const buyerPhoneSchema = z.string().trim().min(6).max(20);

/* ---------------- JSONB value ---------------- */

export const jsonValueSchema: z.ZodType<unknown> = z.union([
  z.string().trim().max(10_000),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.null(),
]);

/* ---------------- Answers ---------------- */

export const adminRegisterAnswerSchema = z
  .object({
    eventFormFieldId: uuidSchema,
    value: jsonValueSchema.optional(),
  })
  .strict();

/* ---------------- Attendees ---------------- */

export const adminRegisterAttendeeSchema = z
  .object({
    eventProductId: uuidSchema,
    answers: z.array(adminRegisterAnswerSchema).max(200).optional(),
  })
  .strict();

/* ---------------- Items ---------------- */

export const adminRegisterItemSchema = z
  .object({
    eventProductId: uuidSchema,
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

/* ---------------- Buyer ---------------- */

export const adminRegisterBuyerSchema = z
  .object({
    email: buyerEmailSchema.optional(),
    name: buyerNameSchema.optional(),
    phone: buyerPhoneSchema.optional(),
    isAttendee: z.boolean().optional(),
  })
  .strict();

/* ---------------- Offline payment ---------------- */

export const offlinePaymentSchema = z
  .object({
    markPaid: z.boolean().optional(),
    payMode: z.enum(["deposit", "full", "custom"]).optional(),
    customAmountCents: z.number().int().min(1).max(50_000_000).optional(),
    paymentMethod: z.enum(["cash", "bank", "card", "other"]).optional(),
    note: z.string().trim().max(2000).optional(),
    idempotencyKey: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.markPaid && p.payMode === "custom" && !p.customAmountCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "CUSTOM_AMOUNT_REQUIRED",
        path: ["customAmountCents"],
      });
    }
  });

/* ---------------- Payload ---------------- */

export const adminRegisterPayloadSchema = z
  .object({
    eventId: uuidSchema,

    items: z.array(adminRegisterItemSchema).min(1).max(50),
    attendees: z.array(adminRegisterAttendeeSchema).max(500),

    buyerEmail: buyerEmailSchema.optional(),
    buyer: adminRegisterBuyerSchema.optional(),

    ...offlinePaymentSchema.shape,
  })
  .strict()
  .superRefine((body, ctx) => {
    const hasBuyer = Boolean(
      body.buyer?.email || body.buyer?.name || body.buyer?.phone,
    );
    const hasLegacy = Boolean(body.buyerEmail);

    if (!hasBuyer && !hasLegacy) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "BUYER_REQUIRED",
        path: ["buyer"],
      });
    }

    const ids = new Set(body.items.map((x) => x.eventProductId));

    body.attendees.forEach((a, i) => {
      if (!ids.has(a.eventProductId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ATTENDEE_PRODUCT_NOT_IN_ITEMS",
          path: ["attendees", i, "eventProductId"],
        });
      }
    });

    const expected = body.items.reduce((acc, it) => acc + it.quantity, 0);

    if (body.attendees.length !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ATTENDEES_COUNT_MISMATCH",
        path: ["attendees"],
      });
    }
  });

export type AdminRegisterPayload = z.infer<typeof adminRegisterPayloadSchema>;

/* ---------------- Response ---------------- */

const orderStatusSchema = z
  .enum([
    "paid",
    "awaiting_payment",
    "partially_paid",
    "expired",
    "pending",
    "canceled",
    "cancelled",
  ])
  .transform((s) => (s === "cancelled" ? "canceled" : s));

const paymentAnySchema = z.unknown().nullable();

export const adminRegisterSuccessSchema = z
  .object({
    ok: z.literal(true),

    orderId: uuidSchema,
    currency: z.string().length(3),

    totalCents: z.number().int().min(0),
    status: orderStatusSchema,

    dueNowCents: z.number().int().min(0).nullable(),
    bookingToken: z.string().trim().min(1).nullable(),
    expiresAt: z.string().nullable(),

    amountAppliedCents: z.number().int().min(0).nullable().optional(),
    payment: paymentAnySchema.optional(),
  })
  .strict();

export const adminRegisterErrorSchema = z
  .object({
    ok: z.literal(false).optional(),
    error: z.string(),
    details: z.unknown().optional(),
  })
  .strict();

export const adminRegisterResponseSchema = z.union([
  adminRegisterSuccessSchema,
  adminRegisterErrorSchema,
]);

export type AdminRegisterResponse = z.infer<typeof adminRegisterResponseSchema>;
export type AdminOrderStatus = z.infer<typeof orderStatusSchema>;
export type AdminRegisterPayloadInput = z.input<typeof adminRegisterPayloadSchema>;
