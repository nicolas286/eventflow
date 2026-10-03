import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { groupDeleteRequestSchema, mutationSuccessSchema, type DeleteEventFormFieldGroupInput } from "@contracts/event-forms";

export function deleteEventFormFieldGroupRepo(supabase: SupabaseClient) {
  return {
    async deleteEventFormFieldGroup(input: DeleteEventFormFieldGroupInput): Promise<void> {
      const body = groupDeleteRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/forms/groups/delete", { body }));
      mutationSuccessSchema.parse(raw);
    },
  };
}
