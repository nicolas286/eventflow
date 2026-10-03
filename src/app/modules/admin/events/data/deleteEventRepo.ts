import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { deleteEventInputSchema, mutationSuccessSchema, type DeleteEventInput } from "@contracts/events";

export function deleteEventRepo(supabase: SupabaseClient) {
  return {
    async deleteEvent(input: DeleteEventInput): Promise<void> {
      const body = deleteEventInputSchema.parse(input);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("events/delete", { body })
      );
      mutationSuccessSchema.parse(raw);
    },
  };
}
