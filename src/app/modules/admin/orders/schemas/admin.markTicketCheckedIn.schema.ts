import { z } from "zod";

/* --------- 📦 shared response -------- */

import {
  type TicketCheckInResponse,
  ticketCheckInResponseSchema,
} from "@contracts/ticket-check-in";
export { type TicketCheckInResponse, ticketCheckInResponseSchema };

/* --------- 📦 mark_ticket_checked_in input -------- */

export const markTicketCheckedInInputSchema = z
  .object({
    p_ticket_id: z.uuid(),
    p_event_id: z.uuid(),
  })
  .strict();

export type MarkTicketCheckedInInput = z.infer<
  typeof markTicketCheckedInInputSchema
>;

export const markTicketCheckedInResponseSchema = ticketCheckInResponseSchema;

export type MarkTicketCheckedInResponse = TicketCheckInResponse;

/* --------- 📦 mark_ticket_checked_in_by_qr input -------- */

export const markTicketCheckedInByQrInputSchema = z
  .object({
    p_qr_token: z.string().trim().min(1, "Le token QR est requis."),
    p_event_id: z.uuid(),
  })
  .strict();

export type MarkTicketCheckedInByQrInput = z.infer<
  typeof markTicketCheckedInByQrInputSchema
>;

export const markTicketCheckedInByQrResponseSchema =
  ticketCheckInResponseSchema;

export type MarkTicketCheckedInByQrResponse = TicketCheckInResponse;
