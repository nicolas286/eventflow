import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { eventDetailRequestSchema, eventDetailAdminCoreSchema, type EventDetailAdminCore } from "@contracts/events";

export type GetEventDetailAdminCoreParams =
  | { orgId: string; eventSlug: string }
  | { eventId: string };

export function makeEventDetailAdminCoreRepo(supabase: SupabaseClient) {
  return {
    async getEventDetailAdminCore(params: GetEventDetailAdminCoreParams): Promise<EventDetailAdminCore> {
      const body = eventDetailRequestSchema.parse(params);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("events/detail", { body })
      );
      return eventDetailAdminCoreSchema.parse(raw);
    },
  };
}
