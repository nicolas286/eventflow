import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { eventsOverviewSchema, type EventsOverview } from "../schemas/admin.eventsOverview.schema";

import { eventsOverviewRequestSchema } from "@contracts/events";

export function makeEventsRepo(supabase: SupabaseClient) {
  return {
    async getEventsOverview(orgId: string): Promise<EventsOverview> {
      const body = eventsOverviewRequestSchema.parse({ orgId });

      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("events/overview", { body }),
      );

      return eventsOverviewSchema.parse(raw);
    },
  };
}
