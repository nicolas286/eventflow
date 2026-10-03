import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { fieldUpdateRequestSchema, fieldUpdatePatchSchema, fieldReadRequestSchema, eventFormFieldSchema, type EventFormField, type UpdateEventFormFieldPatch } from "@contracts/event-forms";
const updateOrReadRequestSchema = fieldReadRequestSchema.extend({ patch: fieldUpdatePatchSchema }).strict();

export function updateEventFormFieldRepo(supabase: SupabaseClient) {
  return {
    async updateEventFormField(input: { fieldId: string; patch: Omit<UpdateEventFormFieldPatch, "id"> }): Promise<EventFormField> {
      const parsed = updateOrReadRequestSchema.parse(input);
      const patch = Object.fromEntries(Object.entries(parsed.patch).filter(([, value]) => value !== undefined));
      const reading = Object.keys(patch).length === 0;
      const body = reading
        ? fieldReadRequestSchema.parse({ fieldId: parsed.fieldId })
        : fieldUpdateRequestSchema.parse({ fieldId: parsed.fieldId, patch });
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke(
        reading ? "events/forms/fields/read" : "events/forms/fields/update", { body }
      ));
      return eventFormFieldSchema.parse(raw);
    },
  };
}
