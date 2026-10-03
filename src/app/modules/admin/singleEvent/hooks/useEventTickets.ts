import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeEventTicketsAdminRepo } from "../data/makeEventTicketsRepo";

import { createSearchEventAdminTicketsStore } from "../../orders/hooks/useSearchEventTicketsView";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";

export function useAdminSingleEventTicketsData(params: {
  supabase: SupabaseClient;
  eventId: string | null | undefined;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}) {
  const {
    supabase,
    eventId,
    enabled = true,
    limit,
    offset = 0,
  } = params;

  const { session } = useAuth();
  const sessionScope = getSessionScope(session);
  const ticketsRepo = useMemo(
    () => makeEventTicketsAdminRepo(supabase),
    [supabase],
  );

  const loadFn = useCallback(async () => {
    if (!eventId) {
      return { data: null };
    }

    const data = await ticketsRepo.getEventTicketsAdmin({
      eventId,
      limit,
      offset,
    });

    return { data };
  }, [eventId, ticketsRepo, limit, offset]);

  const store = useMemo(
    () =>
      createSearchEventAdminTicketsStore(
        loadFn,
        enabled && Boolean(eventId) && sessionScope !== null,
      ),
    [loadFn, enabled, eventId, sessionScope],
  );

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    ...state,
    refetch: store.refetch,
  };
}
