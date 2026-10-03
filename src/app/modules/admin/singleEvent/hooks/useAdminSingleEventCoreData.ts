import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeEventDetailAdminCoreRepo } from "../data/makeEventDetailAdminCoreRepo";
import type { EventDetailAdminCore } from "../schemas/admin.eventDetail.schema";
import { normalizeError } from "@errors/errors";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";

type State = {
  loading: boolean;
  error: string | null;

  eventId: string | null;
  data: EventDetailAdminCore | null;
};

export function createAdminSingleEventCoreStore(
  loadFn: () => Promise<Omit<State, "loading" | "error">>,
  enabled = true,
) {
  const empty: State = {
    loading: enabled,
    error: null,
    eventId: null,
    data: null,
  };
  let state = empty;

  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());

  let started = false;
  let generation = 0;

  async function load() {
    if (!enabled || listeners.size === 0) return;
    const request = ++generation;
    const isCurrent = () => generation === request && listeners.size > 0;
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
        "Impossible de charger les données principales admin de l’événement",
      );
      state = { ...state, loading: false, error: ne.message };
      emit();
    }
  }

  function ensureStarted() {
    if (started) return;
    started = true;
    void load();
  }

  return {
    subscribe(cb: () => void) {
      listeners.add(cb);
      ensureStarted();
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0) {
          generation++;
          state = empty;
          started = false;
        }
      };
    },
    getSnapshot() {
      return state;
    },
    refetch() {
      return load();
    },
    isCurrentScope: () => enabled && listeners.size > 0,
  };
}

export function useAdminSingleEventCoreData(params: {
  supabase: SupabaseClient;
  orgId: string | null | undefined;
  eventSlug: string | null | undefined;
}) {
  const {
    supabase,
    orgId,
    eventSlug,
  } = params;
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);

  const detailRepo = useMemo(
    () => makeEventDetailAdminCoreRepo(supabase),
    [supabase],
  );

  const loadFn = useCallback(async () => {
    if (!orgId || !eventSlug) {
      return { eventId: null, data: null };
    }

    const data = await detailRepo.getEventDetailAdminCore({
      orgId,
      eventSlug,
    });

    const eventId = data?.event?.id ?? null;

    return { eventId, data };
  }, [
    orgId,
    eventSlug,
    detailRepo,
  ]);

  const store = useMemo(
    () => createAdminSingleEventCoreStore(loadFn, sessionScope !== null && !!orgId && !!eventSlug),
    [loadFn, sessionScope, orgId, eventSlug],
  );

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    ...state,
    refetch: store.refetch,
    isCurrentScope: store.isCurrentScope,
  };
}
