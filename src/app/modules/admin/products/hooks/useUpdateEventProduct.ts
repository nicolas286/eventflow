import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateEventProductRepo, type UpdateEventProductPatch } from "../data/updateEventProductRepo";
import { useScopedEventMutation, OrganizerMutationObsoleteError } from "../../singleEvent/hooks/useScopedEventMutation";

export function useUpdateEventProduct(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => updateEventProductRepo(params.supabase), [params.supabase]);
  const update = useMemo(() => (input: { productId: string; patch: UpdateEventProductPatch }) => repo.updateEventProduct(input), [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(update, params, "Impossible de mettre à jour le produit", true);
  async function updateEventProduct(input: { productId: string; patch: UpdateEventProductPatch }) {
    const data = await mutate(input);
    if (!data) throw new OrganizerMutationObsoleteError();
    return data;
  }
  return { ...state, data: result, updateEventProduct };
}
