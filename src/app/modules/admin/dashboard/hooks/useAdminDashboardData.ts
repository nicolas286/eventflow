import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeDashboardRepo } from "@app/modules/admin/dashboard/data/makeDashboardRepo";
import { makeEventsRepo } from "../../events/data/makeEventsRepo";
import type { DashboardBootstrap } from "../schemas/admin.dashboardBootstrap.schema";
import type { EventsOverview, EventOverviewRow } from "../../events/schemas/admin.eventsOverview.schema";
import { normalizeError } from "@errors/errors";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";

type State = {
  loading: boolean;
  error: string | null;

  bootstrap: DashboardBootstrap | null;
  orgId: string | null;

  eventsOverview: EventsOverview | null;
  events: EventOverviewRow[];
};

// mini store (external system)
export function createAdminDashboardStore(loadFn: (
  isCurrent: () => boolean,
  onOrganizationResolved: (orgId: string | null) => void,
) => Promise<State>, enabled = true) {
  const empty: State = {
    loading: true,
    error: null,
    bootstrap: null,
    orgId: null,
    eventsOverview: null,
    events: [],
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
    // Keep the current page mounted during a same-organization refresh. A new
    // session gets a new store; a changed organization is cleared as soon as
    // bootstrap resolves, before any dependent event request starts.
    state = { ...state, loading: true, error: null };
    emit();

    try {
      const next = await loadFn(isCurrent, (orgId) => {
        if (!isCurrent() || state.orgId === orgId) return;
        state = empty;
        emit();
      });
      if (!isCurrent()) return;
      state = next;
      emit();
    } catch (e: unknown) {
      if (!isCurrent()) return;
      const ne = normalizeError(e, "Impossible de charger les données du dashboard");
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
    // react external store API
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

    // action
    refetch() {
      return load();
    },
  };
}

export function useAdminDashboardData(params: { supabase: SupabaseClient }) {
  const { supabase } = params;
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);

  const dashboardRepo = useMemo(() => makeDashboardRepo(supabase), [supabase]);
  const eventsRepo = useMemo(() => makeEventsRepo(supabase), [supabase]);

  // load function (returns full next state)
  const loadFn = useCallback(async (
    isCurrent: () => boolean,
    onOrganizationResolved: (orgId: string | null) => void,
  ): Promise<State> => {
    // 1) bootstrap
    const bootstrap = await dashboardRepo.getDashboardBootstrap();
    if (!isCurrent()) throw new Error("DASHBOARD_REQUEST_OBSOLETE");
    const orgId = bootstrap?.organization?.id ? String(bootstrap.organization.id) : null;
    onOrganizationResolved(orgId);

    // onboarding: pas d’orga
    if (!orgId) {
      return {
        loading: false,
        error: null,
        bootstrap,
        orgId: null,
        eventsOverview: null,
        events: [],
      };
    }

    // 2) events overview
    const eventsOverview = await eventsRepo.getEventsOverview(orgId);
    if (eventsOverview.orgId !== orgId) throw new Error("DASHBOARD_ORGANIZATION_MISMATCH");

    return {
      loading: false,
      error: null,
      bootstrap,
      orgId,
      eventsOverview,
      events: eventsOverview.events,
    };
  }, [dashboardRepo, eventsRepo]);

  // store stable for this hook instance
  const store = useMemo(() => {
    // A token refresh keeps this key stable; a new session creates an empty store.
    return createAdminDashboardStore(loadFn, sessionScope !== null);
  }, [loadFn, sessionScope]);

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    ...state,
    refetch: store.refetch,
  };
}
