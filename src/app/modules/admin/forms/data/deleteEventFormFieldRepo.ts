import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { fieldDeleteRequestSchema, mutationSuccessSchema, type DeleteEventFormFieldInput } from "@contracts/event-forms";

export function deleteEventFormFieldRepo(supabase: SupabaseClient) {
  return {
    async deleteEventFormField(input: DeleteEventFormFieldInput): Promise<void> {
      const body = fieldDeleteRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/forms/fields/delete", { body }));
      mutationSuccessSchema.parse(raw);
    },
  };
}
