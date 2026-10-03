import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteEventRepo } from "../../events/data/deleteEventRepo";
import { useScopedEventMutation } from "./useScopedEventMutation";

export type DeleteEventInput = { eventId: string; orgId?: string };

export function useDeleteEvent(params: { supabase: SupabaseClient; orgId?: string }) {
  const repo = useMemo(() => deleteEventRepo(params.supabase), [params.supabase]);
  const remove = useMemo(() => async (input: DeleteEventInput) => {
    await repo.deleteEvent(input);
    return input.eventId;
  }, [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(remove, params, "Impossible de supprimer l'événement");
  async function deleteEvent(input: DeleteEventInput): Promise<boolean> { return (await mutate(input)) !== null; }
  return { ...state, deletedId: result, deleteEvent };
}
