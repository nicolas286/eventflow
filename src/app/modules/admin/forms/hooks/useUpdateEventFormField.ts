import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateEventFormFieldRepo } from "../data/updateEventFormFieldRepo";
import type { UpdateEventFormFieldPatch, EventFormField } from "@contracts/event-forms";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";
import { normalizeError } from "@errors/errors";

export function useUpdateEventFormField(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => updateEventFormFieldRepo(params.supabase), [params.supabase]);
  const operation = useMemo(() => (input: { fieldId: string; patch: Omit<UpdateEventFormFieldPatch, "id"> }) => repo.updateEventFormField(input), [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(operation, params, "Impossible de modifier le champ de formulaire.", true);
  async function updateEventFormField(input: { fieldId: string; patch: Omit<UpdateEventFormFieldPatch, "id"> }): Promise<{ ok: true; data: EventFormField } | { ok: false; error: string }> {
    try {
      const data = await mutate(input);
      return data ? { ok: true, data } : { ok: false, error: "La demande a été interrompue." };
    } catch (error: unknown) {
      return { ok: false, error: normalizeError(error, "Impossible de modifier le champ de formulaire.").message };
    }
  }
  return { ...state, updated: result, updateEventFormField };
}
