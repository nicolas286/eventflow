import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { updateEventRequestSchema, eventSchema, type Event } from "@contracts/events";
import type { UpdateEventInput } from "../hooks/useUpdateEvent";
import type { UpdateEventPatch } from "../schemas/admin.updateEventPatch.schema";

export function makeUpdateEventRepo(supabase: SupabaseClient) {
  return {
    async updateEvent(input: UpdateEventInput<UpdateEventPatch>): Promise<Event> {
      const body = updateEventRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("events/update", { body })
      );
      return eventSchema.parse(raw);
    },
  };
}
