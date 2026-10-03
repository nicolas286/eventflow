import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { formReorderRequestSchema, mutationSuccessSchema, type FormReorderInput } from "@contracts/event-forms";

export function reorderEventFormRepo(supabase: SupabaseClient) {
  return {
    async reorderEventForm(input: FormReorderInput): Promise<void> {
      const body = formReorderRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/forms/reorder", { body }));
      mutationSuccessSchema.parse(raw);
    },
  };
}
