import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeEventTicketsAdminSearchRepo } from "../data/admin.searchEventTicketsViewRepo";
import type { GetEventTicketsAdminResponse } from "../../singleEvent/schemas/admin.eventTickets.schema";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import { normalizeError } from "@errors/errors";

type State = {
  loading: boolean;
  error: string | null;
  data: GetEventTicketsAdminResponse | null;
};

export function createSearchEventAdminTicketsStore(
  loadFn: () => Promise<Omit<State, "loading" | "error">>,
  enabled: boolean,
) {
  const empty: State = {
    loading: enabled,
    error: null,
    data: null,
  };

  let state = empty;
  let generation = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  let started = false;

  async function load() {
    if (!enabled || listeners.size === 0) return;
    const request = ++generation;
    const isCurrent = () => request === generation && listeners.size > 0;
    state = { ...state, loading: true, error: null };
    emit();

    try {
      const next = await loadFn();
      if (!isCurrent()) return;
      state = { loading: false, error: null, ...next };
      emit();
    } catch (e: unknown) {
      if (!isCurrent()) return;
      const ne = normalizeError(
        e,
        "Impossible de rechercher dans les tickets de l’événement",
      );
      state = { ...state, loading: false, error: ne.message };
      emit();
    }
  }

  function ensureStarted() {
    if (started || !enabled) return;
    started = true;
    void load();
  }

  return {
    subscribe(cb: () => void) {
      listeners.add(cb);
      ensureStarted();
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) { generation++; state = empty; started = false; }
      };
    },
    getSnapshot() {
      return state;
    },
    refetch() {
      return load();
    },
  };
}

export function useSearchEventAdminTicketsData(params: {
  supabase: SupabaseClient;
  eventId: string | null | undefined;
  query: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}) {
  const {
    supabase,
    eventId,
    query,
    enabled = true,
    limit,
    offset = 0,
  } = params;

  const { session } = useAuth();
  const sessionScope = getSessionScope(session);

  const searchRepo = useMemo(
    () => makeEventTicketsAdminSearchRepo(supabase),
    [supabase],
  );

  const trimmedQuery = query.trim();
  const searchEnabled = enabled && Boolean(eventId) && trimmedQuery.length > 0;

  const loadFn = useCallback(async () => {
    if (!eventId || !trimmedQuery) {
      return { data: null };
    }

    const data = await searchRepo.searchEventTicketsAdmin({
      eventId,
      query: trimmedQuery,
      limit,
      offset,
    });

    return { data };
  }, [eventId, trimmedQuery, searchRepo, limit, offset]);

  const store = useMemo(
    () => createSearchEventAdminTicketsStore(loadFn, searchEnabled && sessionScope !== null),
    [loadFn, searchEnabled, sessionScope],
  );

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    ...state,
    refetch: store.refetch,
  };
}