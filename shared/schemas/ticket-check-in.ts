import { z } from "zod";
export { getEventTicketsAdminResponseSchema } from "./orders-management-data.ts";
export const ticketsListRequestSchema = z.object({
  eventId: z.uuid(),
  orgId: z.uuid().optional(),
  limit: z.number().int().min(1).max(1000).default(50),
  offset: z.number().int().min(0).max(10_000_000).default(0),
}).strict();
export const ticketCheckInRequestSchema = z.object({
  eventId: z.uuid(),
  orgId: z.uuid().optional(),
  ticketId: z.uuid(),
}).strict();
export const ticketQrCheckInRequestSchema = z.object({
  eventId: z.uuid(),
  orgId: z.uuid().optional(),
  qrToken: z.string().trim().min(1).max(2048),
}).strict();
export const ticketCheckInResponseSchema = z.object({
  ok: z.literal(true),
  outcome: z.enum(["validated", "already_checked"]),
  ticketId: z.uuid(),
  eventId: z.uuid(),
  orderId: z.uuid(),
  ticketIndex: z.number().int().min(1),
  qrToken: z.string().min(1),
  status: z.string().min(1),
  checkedInAt: z.iso.datetime({ offset: true }),
  checkedInBy: z.uuid(),
}).strict();
export type TicketCheckInResponse = z.infer<typeof ticketCheckInResponseSchema>;
