import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormReorderInput } from "@contracts/event-forms";
import { reorderEventFormRepo } from "../data/reorderEventFormRepo";
import { useScopedEventMutation, OrganizerMutationObsoleteError } from "../../singleEvent/hooks/useScopedEventMutation";

export function useReorderEventForm(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => reorderEventFormRepo(params.supabase), [params.supabase]);
  const operation = useMemo(() => async (input: FormReorderInput) => {
    await repo.reorderEventForm(input);
    return true;
  }, [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(operation, params, "Impossible de réordonner le formulaire.", true);
  async function reorderEventForm(input: FormReorderInput): Promise<void> {
    if (!await mutate(input)) throw new OrganizerMutationObsoleteError();
  }
  return { ...state, reordered: result, reorderEventForm };
}
