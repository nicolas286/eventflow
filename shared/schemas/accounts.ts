import { z } from "zod";

export const deleteAccountInputSchema = z.object({
  orgId: z.uuid().optional(),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>;

export const deleteAccountResultSchema = z.object({
  ok: z.literal(true),

  orgId: z.string().uuid(),
  userId: z.string().uuid(),

  mollieAction: z.enum(["skipped", "already_canceled", "canceled"]).optional(),

  previous: z
    .object({
      status: z.string().max(100).nullable().optional(),
      plan: z.string().max(100).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type DeleteAccountResult = z.infer<typeof deleteAccountResultSchema>;
