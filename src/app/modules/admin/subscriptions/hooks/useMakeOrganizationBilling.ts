import { useMemo, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeOrganizationBillingRepo } from "../data/makeOrganizationBillingRepo";
import type { OrganizationBilling } from "@shared/models/db/db.organizationBilling.schema";
import { normalizeError } from "@errors/errors";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";

type State = {
  loading: boolean;
  error: string | null;
  billing: OrganizationBilling | null;
};

/** The read and save hooks share the same scoped cache and stale-result rules. */
export function createOrganizationBillingStore<Input extends { orgId: string }>(
  loadFn: (input: Input) => Promise<OrganizationBilling | null>,
  errorMessage: string,
  enabled = true,
  selectedOrgId?: string,
) {
  const empty: State = { loading: false, error: null, billing: null };
  let state = empty;
  let generation = 0;
  let currentOrgId: string | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());

  function reset() {
    generation++;
    currentOrgId = null;
    state = empty;
    emit();
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) reset();
      };
    },
    getSnapshot: () => state,
    isCurrentScope: () => enabled && listeners.size > 0,
    reset,
    async load(input: Input): Promise<OrganizationBilling | null> {
      if (!enabled || listeners.size === 0 ||
        (selectedOrgId !== undefined && input.orgId !== selectedOrgId)) return null;
      const request = ++generation;
      const isCurrent = () => generation === request && listeners.size > 0 && currentOrgId === input.orgId;
      const previous = currentOrgId === input.orgId ? state.billing : null;
      currentOrgId = input.orgId;
      state = { loading: true, error: null, billing: previous };
      emit();
      try {
        const billing = await loadFn(input);
        if (!isCurrent()) return null;
        if (billing && billing.orgId !== input.orgId) throw new Error(errorMessage);
        state = { loading: false, error: null, billing };
        emit();
        return billing;
      } catch (error: unknown) {
        if (!isCurrent()) return null;
        const normalized = normalizeError(error, errorMessage);
        state = { loading: false, error: normalized.message, billing: null };
        emit();
        return null;
      }
    },
  };
}

export function useMakeOrganizationBilling(params: { supabase: SupabaseClient; orgId?: string }) {
  const { supabase, orgId } = params;
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);
  const repo = useMemo(() => makeOrganizationBillingRepo(supabase), [supabase]);
  const store = useMemo(() => createOrganizationBillingStore(
    (input: { orgId: string }) => repo.getOrganizationBilling(input.orgId),
    "Impossible de charger les infos de facturation",
    sessionScope !== null,
    orgId,
  ), [repo, sessionScope, orgId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const fetchBilling = useMemo(() => (id: string) => store.load({ orgId: id }), [store]);

  return { ...state, fetchBilling, reset: store.reset, isCurrentScope: store.isCurrentScope };
}
