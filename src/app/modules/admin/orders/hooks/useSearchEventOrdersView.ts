import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeSearchEventAdminOrdersViewRepo } from "../data/admin.searchEventOrdersViewRepo";
import type { EventAdminOrdersView } from "../schemas/admin.eventOrdersView.schema";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import { normalizeError } from "@errors/errors";

type FilterMode = "all" | "order" | `field:${string}`;

type State = {
  loading: boolean;
  error: string | null;
  data: EventAdminOrdersView | null;
};

export function createSearchEventAdminOrdersViewStore(
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
        "Impossible de rechercher dans les commandes de l’événement",
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

export function useSearchEventAdminOrdersViewData(params: {
  supabase: SupabaseClient;
  orgId: string | null | undefined;
  eventSlug: string | null | undefined;
  query: string;
  filterMode: FilterMode;
  enabled?: boolean;
  ordersLimit?: number;
  ordersOffset?: number;
}) {
  const {
    supabase,
    orgId,
    eventSlug,
    query,
    filterMode,
    enabled = true,
    ordersLimit,
    ordersOffset = 0,
  } = params;

  const { session } = useAuth();
  const sessionScope = getSessionScope(session);

  const searchRepo = useMemo(
    () => makeSearchEventAdminOrdersViewRepo(supabase),
    [supabase],
  );

  const trimmedQuery = query.trim();
  const searchEnabled = enabled && Boolean(orgId) && Boolean(eventSlug) && trimmedQuery.length > 0;

  const loadFn = useCallback(async () => {
    if (!orgId || !eventSlug || !trimmedQuery) {
      return { data: null };
    }

    const data = await searchRepo.searchEventAdminOrdersView({
      orgId,
      eventSlug,
      query: trimmedQuery,
      filterMode,
      ordersLimit,
      ordersOffset,
    });

    return { data };
  }, [
    orgId,
    eventSlug,
    trimmedQuery,
    filterMode,
    searchRepo,
    ordersLimit,
    ordersOffset,
  ]);

  const store = useMemo(
    () => createSearchEventAdminOrdersViewStore(loadFn, searchEnabled && sessionScope !== null),
    [loadFn, searchEnabled, sessionScope],
  );

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    ...state,
    refetch: store.refetch,
  };
}