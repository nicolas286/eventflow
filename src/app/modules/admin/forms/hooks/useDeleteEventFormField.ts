import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteEventFormFieldRepo } from "../data/deleteEventFormFieldRepo";
import type { DeleteEventFormFieldInput } from "@contracts/event-forms";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";

export function useDeleteEventFormField(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => deleteEventFormFieldRepo(params.supabase), [params.supabase]);
  const operation = useMemo(() => async (input: DeleteEventFormFieldInput) => { await repo.deleteEventFormField(input); return true; }, [repo]);
  const { mutate, result: deleted, ...state } = useScopedEventMutation(operation, params, "Impossible de supprimer le champ de formulaire.");
  const deleteEventFormField = async (input: DeleteEventFormFieldInput) => (await mutate(input)) === true;
  return { ...state, deleted, deleteEventFormField };
}
