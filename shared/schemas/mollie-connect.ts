import { z } from "zod";

export const mollieConnectModeSchema = z.enum(["test", "live"]);

export const startMollieConnectInputSchema = z.object({
  orgId: z.uuid(),
  mode: mollieConnectModeSchema,
});

export type StartMollieConnectInput = z.infer<typeof startMollieConnectInputSchema>;

export const startMollieConnectResultSchema = z.object({
  ok: z.literal(true),
  url: z.url().max(8192),
});

export type StartMollieConnectResult = z.infer<typeof startMollieConnectResultSchema>;
