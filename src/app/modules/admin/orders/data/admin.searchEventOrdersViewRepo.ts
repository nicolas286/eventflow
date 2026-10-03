import type { SupabaseClient } from "@supabase/supabase-js";

import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { ordersSearchRequestSchema } from "@contracts/orders-management";


import {
  eventAdminOrdersViewSchema,
  type EventAdminOrdersView,
} from "../schemas/admin.eventOrdersView.schema";

type Paging = {
  ordersLimit?: number;
  ordersOffset?: number;
};

type SearchArgs = {
  query: string;
  filterMode: "all" | "order" | `field:${string}`;
};

export type SearchEventAdminOrdersViewParams =
  | ({ orgId: string; eventSlug: string } & Paging & SearchArgs)
  | ({ eventId: string } & Paging & SearchArgs);

export function makeSearchEventAdminOrdersViewRepo(supabase: SupabaseClient) {
  return {
    async searchEventAdminOrdersView(
      params: SearchEventAdminOrdersViewParams,
    ): Promise<EventAdminOrdersView> {
      const payload = ordersSearchRequestSchema.parse(params);
      const raw = await edgeSafe<unknown>(
        () => supabase.functions.invoke("orders/admin/search", { body: payload }),
        "ORDERS_ADMIN_EMPTY_RESPONSE",
      );
      return eventAdminOrdersViewSchema.parse(raw);
    },
  };
}