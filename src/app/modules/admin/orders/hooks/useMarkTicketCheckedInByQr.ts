import { useCallback, useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { markTicketCheckedInByQrRepo } from "../data/markTicketCheckedInByQrRepo";
import {
  OrganizerMutationObsoleteError,
  useScopedEventMutation,
} from "../../singleEvent/hooks/useScopedEventMutation";
export function useMarkTicketCheckedInByQr(
  params: { supabase: SupabaseClient; eventId: string },
) {
  const repo = useMemo(() => markTicketCheckedInByQrRepo(params.supabase), [
    params.supabase,
  ]);
  const mutate = useCallback(
    (input: { qrToken: string; eventId: string }) =>
      repo.markTicketCheckedInByQr(input),
    [repo],
  );
  const scoped = useScopedEventMutation(
    mutate,
    { eventId: params.eventId },
    "Impossible de valider le billet",
    true,
  );
  const mutateScoped = scoped.mutate;
  const markTicketCheckedInByQr = useCallback(
    async (qrToken: string, eventId: string) => {
      if (eventId !== params.eventId) {
        throw new OrganizerMutationObsoleteError();
      }
      const result = await mutateScoped({ qrToken, eventId });
      if (!result) throw new OrganizerMutationObsoleteError();
      return result;
    },
    [params.eventId, mutateScoped],
  );
  return { ...scoped, markTicketCheckedInByQr };
}
