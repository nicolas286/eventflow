import { useCallback, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markTicketCheckedInRepo } from "../data/markTicketChekedInRepo";
import {
  OrganizerMutationObsoleteError,
  useScopedEventMutation,
} from "../../singleEvent/hooks/useScopedEventMutation";
export function useMarkTicketCheckedIn(
  params: { supabase: SupabaseClient; eventId: string },
) {
  const repo = useMemo(() => markTicketCheckedInRepo(params.supabase), [
    params.supabase,
  ]);
  const mutate = useCallback(
    (input: { ticketId: string; eventId: string }) =>
      repo.markTicketCheckedIn(input),
    [repo],
  );
  const scoped = useScopedEventMutation(
    mutate,
    { eventId: params.eventId },
    "Impossible de valider le billet",
    true,
  );
  const mutateScoped = scoped.mutate;
  const markTicketCheckedIn = useCallback(
    async (ticketId: string, eventId: string) => {
      if (eventId !== params.eventId) {
        throw new OrganizerMutationObsoleteError();
      }
      const result = await mutateScoped({ ticketId, eventId });
      if (!result) throw new OrganizerMutationObsoleteError();
      return result;
    },
    [params.eventId, mutateScoped],
  );
  return { ...scoped, markTicketCheckedIn };
}
