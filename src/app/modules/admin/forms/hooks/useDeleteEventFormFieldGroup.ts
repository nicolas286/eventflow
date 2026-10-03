import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteEventFormFieldGroupRepo } from "../data/deleteEventFormFieldGroupRepo";
import type { DeleteEventFormFieldGroupInput } from "@contracts/event-forms";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";

export function useDeleteEventFormFieldGroup(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => deleteEventFormFieldGroupRepo(params.supabase), [params.supabase]);
  const operation = useMemo(() => async (input: DeleteEventFormFieldGroupInput) => { await repo.deleteEventFormFieldGroup(input); return true; }, [repo]);
  const { mutate, result: deleted, ...state } = useScopedEventMutation(operation, params, "Impossible de supprimer le groupe de champs.");
  const deleteEventFormFieldGroup = async (input: DeleteEventFormFieldGroupInput) => (await mutate(input)) === true;
  return { ...state, deleted, deleteEventFormFieldGroup };
}
