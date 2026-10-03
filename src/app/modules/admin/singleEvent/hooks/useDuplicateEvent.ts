import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEventsRepo } from "@app/modules/admin/singleEvent/data/createEventRepo";
import type { DuplicateEventInput } from "../schemas/admin.duplicateEvent.schema";
import { useScopedEventMutation } from "./useScopedEventMutation";

export function useDuplicateEvent(params: { supabase: SupabaseClient; orgId?: string }) {
  const repo = useMemo(() => createEventsRepo(params.supabase), [params.supabase]);
  const duplicate = useMemo(() => (input: DuplicateEventInput) => repo.duplicateEvent(input), [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(duplicate, params, "Impossible de dupliquer l'événement");
  return { ...state, duplicated: result, duplicateEvent: mutate };
}
