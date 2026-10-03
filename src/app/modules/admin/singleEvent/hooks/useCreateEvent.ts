import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEventsRepo } from "@app/modules/admin/singleEvent/data/createEventRepo";
import type { CreateEventInput } from "../../events/schemas/admin.createEvent.schema";
import { useScopedEventMutation } from "./useScopedEventMutation";

export function useCreateEvent(params: { supabase: SupabaseClient; orgId?: string }) {
  const repo = useMemo(() => createEventsRepo(params.supabase), [params.supabase]);
  const create = useMemo(() => (input: CreateEventInput) => repo.createEvent(input), [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(create, params, "Impossible de créer l'événement");
  return { ...state, created: result, createEvent: mutate };
}
