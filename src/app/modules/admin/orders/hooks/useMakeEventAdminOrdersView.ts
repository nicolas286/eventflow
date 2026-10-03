import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeEventAdminOrdersViewRepo } from "../data/makeEventAdminOrdersViewRepo";
import type { EventAdminOrdersView } from "../schemas/admin.eventOrdersView.schema";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import { normalizeError } from "@errors/errors";

type State = {
  loading: boolean;
  error: string | null;
  data: EventAdminOrdersView | null;
};

export function createAdminSingleEventOrdersViewStore(
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
        "Impossible de charger les commandes de l’événement",
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

export function useAdminSingleEventOrdersViewData(params: {
  supabase: SupabaseClient;
  orgId: string | null | undefined;
  eventSlug: string | null | undefined;
  enabled?: boolean;
  ordersLimit?: number;
  ordersOffset?: number;
}) {
  const {
    supabase,
    orgId,
    eventSlug,
    enabled = true,
    ordersLimit,
    ordersOffset = 0,
  } = params;

  const { session } = useAuth();
  const sessionScope = getSessionScope(session);

  const ordersRepo = useMemo(
    () => makeEventAdminOrdersViewRepo(supabase),
    [supabase],
  );

  const loadFn = useCallback(async () => {
    if (!orgId || !eventSlug) {
      return { data: null };
    }

    const data = await ordersRepo.getEventAdminOrdersView({
      orgId,
      eventSlug,
      ordersLimit,
      ordersOffset,
    });

    return { data };
  }, [
    orgId,
    eventSlug,
    ordersRepo,
    ordersLimit,
    ordersOffset,
  ]);

  const store = useMemo(
    () => createAdminSingleEventOrdersViewStore(loadFn, enabled && sessionScope !== null),
    [loadFn, enabled, sessionScope],
  );

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    ...state,
    refetch: store.refetch,
  };
}