import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  ticketCheckInRequestSchema,
  ticketCheckInResponseSchema,
} from "@contracts/ticket-check-in";
export type MarkTicketCheckedInParams = { ticketId: string; eventId: string };
export function markTicketCheckedInRepo(supabase: SupabaseClient) {
  return {
    async markTicketCheckedIn(params: MarkTicketCheckedInParams) {
      const body = ticketCheckInRequestSchema.parse(params);
      const raw = await edgeSafe<unknown>(
        () =>
          supabase.functions.invoke("orders/admin/ticket-check-in", { body }),
        "ORDERS_ADMIN_EMPTY_RESPONSE",
      );
      return ticketCheckInResponseSchema.parse(raw);
    },
  };
}
