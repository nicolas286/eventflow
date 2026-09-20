import { z } from "zod";

/** Maintenance is read-only unless apply is explicitly true. */
export const migrateSubscriptionWebhooksSchema = z.object({
  apply: z.boolean().optional().default(false),
}).strict();
