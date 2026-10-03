import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEventFormFieldGroupRepo } from "../data/createEventFormFieldGroupRepo";
import type { CreateEventFormFieldGroupInput } from "@contracts/event-forms";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";

export function useCreateEventFormFieldGroup(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => createEventFormFieldGroupRepo(params.supabase), [params.supabase]);
  const operation = useMemo(() => (input: CreateEventFormFieldGroupInput) => repo.createEventFormFieldGroup(input), [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(operation, params, "Impossible de créer le groupe de champs.");
  const createEventFormFieldGroup = mutate;
  return { ...state, created: result, createEventFormFieldGroup };
}
