import { z } from "zod";

/* ------------------------- Primitives ------------------------- */

export const uuidSchema = z.uuid();

export const buyerEmailSchema = z.email().trim().max(254);
export const buyerNameSchema = z.string().trim().min(2).max(120);
export const buyerPhoneSchema = z.string().trim().min(6).max(20);

export const promoCodeSchema = z
  .string()
  .trim()
  .max(20)
  .transform((v) => v || null);

/* ------------------------- JSONB value ------------------------- */

export const jsonValueSchema: z.ZodType<unknown> = z.union([
  z.string().trim().max(10_000),
  z.number(),
  z.boolean(),
  z.record(z.string(), z.unknown()),
  z.array(z.unknown()),
  z.null(),
]);

/* ------------------------- Answers ------------------------- */

export const registerAnswerSchema = z
  .object({
    eventFormFieldId: uuidSchema,
    value: jsonValueSchema.optional(),
  })
  .strict();

/* ------------------------- Attendees ------------------------- */

export const registerAttendeeSchema = z
  .object({
    eventProductId: uuidSchema,
    answers: z.array(registerAnswerSchema).max(200).optional(),
  })
  .strict();

/* ------------------------- Items ------------------------- */

export const registerItemSchema = z
  .object({
    eventProductId: uuidSchema,
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

/* ------------------------- Buyer ------------------------- */

export const registerBuyerSchema = z
  .object({
    email: buyerEmailSchema.optional(),
    name: buyerNameSchema.optional(),
    phone: buyerPhoneSchema.optional(),
    isAttendee: z.boolean().optional(),
  })
  .strict();

/* ------------------------- Register payload ------------------------- */

export const registerPayloadSchema = z
  .object({
    eventId: uuidSchema,

    items: z.array(registerItemSchema).min(1).max(50),
    attendees: z.array(registerAttendeeSchema).max(500),

    // legacy compat
    buyerEmail: buyerEmailSchema.optional(),

    // current
    buyer: registerBuyerSchema.optional(),

    turnstileToken: z.string().trim().min(1).max(5000),

    widgetReturnUrl: z.string().trim().min(1).max(2048).optional(),
    checkoutSource: z.enum(["widget", "public"]).optional(),
    promoCode: promoCodeSchema.optional().nullable(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const effectiveBuyerEmail = body.buyer?.email ?? body.buyerEmail;

    if (!effectiveBuyerEmail) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "BUYER_EMAIL_REQUIRED",
        path: ["buyer", "email"],
      });
    }

    const itemProductIds = new Set(body.items.map((x) => x.eventProductId));

    body.attendees.forEach((attendee, index) => {
      if (!itemProductIds.has(attendee.eventProductId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "ATTENDEE_PRODUCT_NOT_IN_ITEMS",
          path: ["attendees", index, "eventProductId"],
        });
      }
    });
  });

export type RegisterPayloadInput = z.input<typeof registerPayloadSchema>;
export type RegisterPayload = z.output<typeof registerPayloadSchema>;

/* ------------------------- Register response ------------------------- */

export const registerSuccessPaidSchema = z
  .object({
    ok: z.literal(true),
    orderId: uuidSchema,
    status: z.literal("paid"),
    bookingToken: z.string().nullable().optional(),

    totalCents: z.number().int().min(0).optional(),
    amountDueNowCents: z.number().int().min(0).optional(),
    discountCents: z.number().int().min(0).optional(),
  })
  .strict();

export const registerSuccessAwaitingPaymentSchema = z
  .object({
    ok: z.literal(true),
    orderId: uuidSchema,
    status: z.literal("awaiting_payment"),
    checkoutUrl: z.string().url(),

    amountDueNowCents: z.number().int().min(1),
    totalCents: z.number().int().min(0),
    discountCents: z.number().int().min(0).optional(),

    reusedPayment: z.boolean().optional(),
    bookingToken: z.string(),
  })
  .strict();

export const registerSuccessSchema = z.union([
  registerSuccessPaidSchema,
  registerSuccessAwaitingPaymentSchema,
]);

export const registerErrorSchema = z
  .object({
    ok: z.literal(false).optional(),
    error: z.string(),
    details: z.unknown().optional(),
  })
  .strict();

export const registerResponseSchema = z.union([
  registerSuccessSchema,
  registerErrorSchema,
]);

export type RegisterResponse = z.infer<typeof registerResponseSchema>;
export type RegisterSuccess = z.infer<typeof registerSuccessSchema>;

/* ------------------------- RPC args ------------------------- */

export const createOrderIntentAnswerArgSchema = z
  .object({
    event_form_field_id: uuidSchema,
    value: jsonValueSchema.nullable().optional(),
  })
  .strict();

export const createOrderIntentAttendeeArgSchema = z
  .object({
    event_product_id: uuidSchema,

    // DB actuelle : infos participant stockÃ©es dans answers
    first_name: z.null(),
    last_name: z.null(),
    email: z.null(),
    phone: z.null(),

    answers: z.array(createOrderIntentAnswerArgSchema).optional(),
  })
  .strict();

export const createOrderIntentItemArgSchema = z
  .object({
    event_product_id: uuidSchema,
    quantity: z.number().int().min(1).max(100),
  })
  .strict();

export const createOrderIntentBuyerArgSchema = z
  .object({
    email: buyerEmailSchema.nullable().optional(),
    name: buyerNameSchema.nullable().optional(),
    phone: buyerPhoneSchema.nullable().optional(),
    is_attendee: z.boolean().nullable().optional(),
  })
  .strict();

export const createOrderIntentArgsSchema = z
  .object({
    p_event_id: uuidSchema,
    p_items: z.array(createOrderIntentItemArgSchema).min(1).max(50),
    p_attendees: z.array(createOrderIntentAttendeeArgSchema).max(500),
    p_buyer: createOrderIntentBuyerArgSchema,
    p_rate_key: z.string().min(1),
    p_promo_code: promoCodeSchema.nullable().optional(),
  })
  .strict();

export type CreateOrderIntentArgs = z.infer<typeof createOrderIntentArgsSchema>;

/* ------------------------- Mapper helpers ------------------------- */

export function toCreateOrderIntentArgs(
  payload: RegisterPayload,
  rateKey: string
): CreateOrderIntentArgs {
  const buyer = payload.buyer ?? {};
  const email = buyer.email ?? payload.buyerEmail ?? null;

  return {
    p_event_id: payload.eventId,

    p_items: payload.items.map((item) => ({
      event_product_id: item.eventProductId,
      quantity: item.quantity,
    })),

    p_attendees: payload.attendees.map((attendee) => ({
      event_product_id: attendee.eventProductId,
      first_name: null,
      last_name: null,
      email: null,
      phone: null,
      answers: (attendee.answers ?? []).map((answer) => ({
        event_form_field_id: answer.eventFormFieldId,
        value: answer.value ?? null,
      })),
    })),

    p_buyer: {
      email,
      name: buyer.name ?? null,
      phone: buyer.phone ?? null,
      is_attendee:
        typeof buyer.isAttendee === "boolean" ? buyer.isAttendee : null,
    },

    p_promo_code: payload.promoCode ?? null,
    p_rate_key: rateKey,
  };
}