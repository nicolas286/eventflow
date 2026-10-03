import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { groupUpdateRequestSchema, groupUpdatePatchSchema, groupReadRequestSchema, eventFormFieldGroupSchema, type EventFormFieldGroup, type UpdateEventFormFieldGroupPatch } from "@contracts/event-forms";
const updateOrReadRequestSchema = groupReadRequestSchema.extend({ patch: groupUpdatePatchSchema }).strict();

export function updateEventFormFieldGroupRepo(supabase: SupabaseClient) {
  return {
    async updateEventFormFieldGroup(input: { groupId: string; patch: Omit<UpdateEventFormFieldGroupPatch, "id"> }): Promise<EventFormFieldGroup> {
      const parsed = updateOrReadRequestSchema.parse(input);
      const patch = Object.fromEntries(Object.entries(parsed.patch).filter(([, value]) => value !== undefined));
      const reading = Object.keys(patch).length === 0;
      const body = reading
        ? groupReadRequestSchema.parse({ groupId: parsed.groupId })
        : groupUpdateRequestSchema.parse({ groupId: parsed.groupId, patch });
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke(
        reading ? "events/forms/groups/read" : "events/forms/groups/update", { body }
      ));
      return eventFormFieldGroupSchema.parse(raw);
    },
  };
}
