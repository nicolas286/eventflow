import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { groupCreateRequestSchema, eventFormFieldGroupSchema, type EventFormFieldGroup, type CreateEventFormFieldGroupInput } from "@contracts/event-forms";

export function createEventFormFieldGroupRepo(supabase: SupabaseClient) {
  return {
    async createEventFormFieldGroup(input: CreateEventFormFieldGroupInput): Promise<EventFormFieldGroup> {
      const body = groupCreateRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/forms/groups/create", { body }));
      return eventFormFieldGroupSchema.parse(raw);
    },
  };
}
