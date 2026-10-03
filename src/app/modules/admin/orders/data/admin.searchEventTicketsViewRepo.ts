import type { SupabaseClient } from "@supabase/supabase-js";

import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { ticketsSearchRequestSchema } from "@contracts/orders-management";


import {
  getEventTicketsAdminResponseSchema,
  type GetEventTicketsAdminResponse,
} from "../../singleEvent/schemas/admin.eventTickets.schema";

export type SearchEventTicketsAdminParams = {
  eventId: string;
  query: string;
  limit?: number;
  offset?: number;
};

export function makeEventTicketsAdminSearchRepo(supabase: SupabaseClient) {
  return {
    async searchEventTicketsAdmin(
      params: SearchEventTicketsAdminParams,
    ): Promise<GetEventTicketsAdminResponse> {
      const payload = ticketsSearchRequestSchema.parse(params);
      const raw = await edgeSafe<unknown>(
        () => supabase.functions.invoke("orders/admin/tickets-search", { body: payload }),
        "ORDERS_ADMIN_EMPTY_RESPONSE",
      );
      return getEventTicketsAdminResponseSchema.parse(raw);
    },
  };
}