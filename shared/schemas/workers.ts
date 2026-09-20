import { z } from "zod";
export const cronReminderPayloadSchema = z.object({
  mode: z.literal("cron").optional().default("cron"),
});

export const manualReminderPayloadSchema = z.object({
  mode: z.literal("manual"),
  orderId: z.string().uuid(),
  /**
   * Par défaut le mode manuel sert de dry-run : on construit le mail,
   * mais on ne loggue pas l'idempotence et on ne l'envoie pas.
   */
  debug: z.boolean().optional().default(true),
});
