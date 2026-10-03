import type { SupabaseClient } from "@supabase/supabase-js";

import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { ordersListRequestSchema } from "@contracts/orders-management";


import {
  eventAdminOrdersViewSchema,
  type EventAdminOrdersView,
} from "../schemas/admin.eventOrdersView.schema";

type Paging = {
  ordersLimit?: number;
  ordersOffset?: number;
};

export type GetEventAdminOrdersViewParams =
  | ({ orgId: string; eventSlug: string } & Paging)
  | ({ eventId: string } & Paging);

export function makeEventAdminOrdersViewRepo(supabase: SupabaseClient) {
  return {
    async getEventAdminOrdersView(
      params: GetEventAdminOrdersViewParams,
    ): Promise<EventAdminOrdersView> {
      const payload = ordersListRequestSchema.parse(params);
      const raw = await edgeSafe<unknown>(
        () => supabase.functions.invoke("orders/admin/list", { body: payload }),
        "ORDERS_ADMIN_EMPTY_RESPONSE",
      );
      return eventAdminOrdersViewSchema.parse(raw);
    },
  };
}