import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateEventFormFieldGroupRepo } from "../data/updateEventFormFieldGroupRepo";
import type { UpdateEventFormFieldGroupPatch } from "@contracts/event-forms";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";

export function useUpdateEventFormFieldGroup(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => updateEventFormFieldGroupRepo(params.supabase), [params.supabase]);
  const operation = useMemo(() => (input: { groupId: string; patch: Omit<UpdateEventFormFieldGroupPatch, "id"> }) => repo.updateEventFormFieldGroup(input), [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(operation, params, "Impossible de modifier le groupe de champs.");
  const updateEventFormFieldGroup = mutate;
  return { ...state, updated: result, updateEventFormFieldGroup };
}
