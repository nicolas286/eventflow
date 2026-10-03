import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { fieldCreateRequestSchema, eventFormFieldSchema, type EventFormField, type CreateEventFormFieldInput } from "@contracts/event-forms";

export function createEventFormFieldRepo(supabase: SupabaseClient) {
  return {
    async createEventFormField(input: CreateEventFormFieldInput): Promise<EventFormField> {
      const body = fieldCreateRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/forms/fields/create", { body }));
      return eventFormFieldSchema.parse(raw);
    },
  };
}
