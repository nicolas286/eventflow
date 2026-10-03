import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEventProductRepo } from "../data/createEventProductRepo";
import type { CreateEventProductInput } from "../schemas/admin.createEventProduct.schema";
import { useScopedEventMutation, OrganizerMutationObsoleteError } from "../../singleEvent/hooks/useScopedEventMutation";

export function useCreateEventProduct(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => createEventProductRepo(params.supabase), [params.supabase]);
  const create = useMemo(() => (input: CreateEventProductInput) => repo.createEventProduct(input), [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(create, params, "Impossible de créer le produit", true);
  async function createEventProduct(input: CreateEventProductInput) {
    const data = await mutate(input);
    if (!data) throw new OrganizerMutationObsoleteError();
    return data;
  }
  return { ...state, data: result, createEventProduct };
}
