import { z } from "zod";

export const deleteAccountInputSchema = z.object({
  orgId: z.uuid().optional(),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountInputSchema>;

export const deleteAccountResultSchema = z.object({
  ok: z.literal(true),

  orgId: z.string().uuid(),
  userId: z.string().uuid(),

  previous: z
    .object({
      status: z.any().nullable().optional(),
      plan: z.any().nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type DeleteAccountResult = z.infer<typeof deleteAccountResultSchema>;
