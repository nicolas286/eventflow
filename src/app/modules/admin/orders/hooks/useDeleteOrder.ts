import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteOrderRepo } from "../data/deleteOrderRepo";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";
export type DeleteOrderInput = { orderId: string };
export function useDeleteOrder(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => deleteOrderRepo(params.supabase), [params.supabase]);
  const remove = useMemo(() => async (input: DeleteOrderInput) => {
    await repo.deleteOrder({ id: input.orderId, orgId: params.orgId, eventId: params.eventId });
    return input.orderId;
  }, [repo, params.orgId, params.eventId]);
  const { mutate, result, ...state } = useScopedEventMutation(remove, params, "Impossible de supprimer la commande");
  async function deleteOrder(input: DeleteOrderInput): Promise<boolean> { return (await mutate(input)) !== null; }
  return { ...state, deletedId: result, deleteOrder };
}
