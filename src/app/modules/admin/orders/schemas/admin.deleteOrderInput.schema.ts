import { z } from "zod";

export const deleteOrderInputSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid().optional(), eventId: z.uuid().optional(),
}).strict();

export type DeleteOrderInput = z.infer<typeof deleteOrderInputSchema>;
