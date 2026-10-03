import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminUpdateOrderAttendeeRepo } from "../data/updateOrderAttendeeRepo";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";
export function useAdminUpdateOrderAttendee(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => adminUpdateOrderAttendeeRepo(params.supabase), [params.supabase]);
  const update = useMemo(() => repo.updateOrderAttendee, [repo]);
  const { mutate, ...state } = useScopedEventMutation(update, params, "Impossible de modifier le participant");
  return { ...state, updateOrderAttendee: mutate };
}
