import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  getEventTicketsAdminResponseSchema,
  ticketsListRequestSchema,
} from "@contracts/ticket-check-in";
export type GetEventTicketsAdminParams = {
  eventId: string;
  limit?: number;
  offset?: number;
};
export function makeEventTicketsAdminRepo(supabase: SupabaseClient) {
  return {
    async getEventTicketsAdmin(params: GetEventTicketsAdminParams) {
      const body = ticketsListRequestSchema.parse(params);
      const raw = await edgeSafe<unknown>(
        () => supabase.functions.invoke("orders/admin/tickets-list", { body }),
        "ORDERS_ADMIN_EMPTY_RESPONSE",
      );
      return getEventTicketsAdminResponseSchema.parse(raw);
    },
  };
}
