import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteEventProductRepo } from "../data/deleteEventProductRepo";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";
export type DeleteEventProductInput = { id: string };

export function useDeleteEventProduct(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => deleteEventProductRepo(params.supabase), [params.supabase]);
  const remove = useMemo(() => async (input: DeleteEventProductInput) => {
    await repo.deleteEventProduct(input);
    return input.id;
  }, [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(remove, params, "Impossible de supprimer le produit");
  async function deleteEventProduct(input: DeleteEventProductInput): Promise<boolean> { return (await mutate(input)) !== null; }
  return { ...state, deletedId: result, deleteEventProduct };
}
