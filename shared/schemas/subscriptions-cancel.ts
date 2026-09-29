import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Payload                                                            */
/* ------------------------------------------------------------------ */

export const cancelSubscriptionPayloadSchema = z.object({
  orgId: z.string().uuid(),
});

export type CancelSubscriptionPayload = z.infer<
  typeof cancelSubscriptionPayloadSchema
>;

/* ------------------------------------------------------------------ */
/* Response                                                           */
/* ------------------------------------------------------------------ */

export const cancelSubscriptionResponseSchema = z.object({
  ok: z.boolean(),
  action: z.literal("canceled").optional(),
  orgId: z.string().uuid().optional(),

  // Optionnels (debug)
  mollieCustomerId: z.string().optional().nullable(),
  mollieSubscriptionId: z.string().optional().nullable(),
  previous: z
    .object({
      status: z.string().optional().nullable(),
      plan: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),

  warning: z.string().optional(),
  error: z.string().optional(),
  details: z.unknown().optional(),
});

export type CancelSubscriptionResponse = z.infer<
  typeof cancelSubscriptionResponseSchema
>;
