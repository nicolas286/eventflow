import { useMemo, useSyncExternalStore } from "react";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import { normalizeError } from "@errors/errors";

export function createScopedEventMutationStore<Input, Result>(
  mutateFn: (input: Input) => Promise<Result>,
  errorMessage: string,
  enabled = true,
  propagateErrors = false,
) {
  const empty: { loading: boolean; error: string | null; result: Result | null } = {
    loading: false, error: null, result: null,
  };
  let state = empty;
  let generation = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const isCurrentScope = () => enabled && listeners.size > 0;
  const reset = () => {
    generation++;
    state = empty;
    emit();
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) reset();
      };
    },
    getSnapshot: () => state,
    reset,
    isCurrentScope,
    async mutate(input: Input): Promise<Result | null> {
      if (!isCurrentScope()) return null;
      const request = ++generation;
      const isCurrent = () => generation === request && isCurrentScope();
      state = { ...empty, loading: true };
      emit();
      try {
        const result = await mutateFn(input);
        if (!isCurrent()) return null;
        state = { loading: false, error: null, result };
        emit();
        return result;
      } catch (error: unknown) {
        if (!isCurrent()) return null;
        const normalized = normalizeError(error, errorMessage);
        state = { ...empty, error: normalized.message };
        emit();
        if (propagateErrors) throw normalized;
        return null;
      }
    },
  };
}

export function useScopedEventMutation<Input, Result>(
  mutateFn: (input: Input) => Promise<Result>,
  params: { orgId?: string; eventId?: string },
  errorMessage: string,
  propagateErrors = false,
) {
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);
  const { orgId, eventId } = params;
  const store = useMemo(() => createScopedEventMutationStore(mutateFn, errorMessage,
    sessionScope !== null && orgId !== "" && eventId !== "", propagateErrors),
    [mutateFn, errorMessage, sessionScope, orgId, eventId, propagateErrors]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return { ...state, mutate: store.mutate, reset: store.reset, isCurrentScope: store.isCurrentScope };
}

/** Discarded UI work is ignored by callers instead of showing a failed save. */
export class OrganizerMutationObsoleteError extends Error {
  constructor() {
    super("La demande a été interrompue.");
    this.name = "OrganizerMutationObsoleteError";
  }
}
