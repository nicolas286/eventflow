import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bankTransferAdminRepo } from "../data/bankTransferAdminRepo";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import { normalizeError } from "@errors/errors";
import type { BankTransferAdminSummary } from "@contracts/bank-transfer";

export function createBankTransferReadStore(load: () => Promise<BankTransferAdminSummary[]>, enabled: boolean) {
  const empty: { summaries: BankTransferAdminSummary[]; loading: boolean; error: string | null } = {
    summaries: [], loading: enabled, error: null,
  };
  let state = empty, generation = 0, started = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  async function refresh() {
    if (!enabled || listeners.size === 0) return;
    const request = ++generation;
    const current = () => request === generation && listeners.size > 0;
    state = { ...state, loading: true, error: null }; emit();
    try {
      const summaries = await load();
      if (!current()) return;
      state = { summaries, loading: false, error: null }; emit();
    } catch (error: unknown) {
      if (!current()) return;
      state = { ...state, loading: false, error: normalizeError(error, "Impossible de charger les virements bancaires").message }; emit();
    }
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!started) { started = true; void refresh(); }
      return () => { listeners.delete(listener); if (listeners.size === 0) { generation++; state = empty; started = false; } };
    },
    getSnapshot: () => state, refresh,
    resetError: () => { state = { ...state, error: null }; emit(); },
  };
}

export function useBankTransferAdmin(input: { supabase: SupabaseClient; eventId: string }) {
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);
  const repo = useMemo(() => bankTransferAdminRepo(input.supabase), [input.supabase]);
  const load = useMemo(() => async () => repo.list(input.eventId), [repo, input.eventId]);
  const remove = useMemo(() => async (orderId: string) => ({ orderId, value: await repo.expire(orderId, input.eventId) }), [repo, input.eventId]);
  const readingStore = useMemo(() => createBankTransferReadStore(load, sessionScope !== null && !!input.eventId), [load, sessionScope, input.eventId]);
  const reading = useSyncExternalStore(readingStore.subscribe, readingStore.getSnapshot);
  const writing = useScopedEventMutation(remove, input, "Impossible d'expirer la réservation");
  const [expiringId, setExpiringId] = useState<string | null>(null);
  const refresh = readingStore.refresh;
  const expire = useCallback(async (orderId: string) => {
    if (!writing.isCurrentScope()) return null;
    setExpiringId(orderId);
    const result = await writing.mutate(orderId);
    if (!result || !writing.isCurrentScope()) return null;
    await refresh();
    return writing.isCurrentScope() ? result.value : null;
  }, [writing, refresh]);
  return { summaries: reading.summaries, loading: reading.loading,
    expiringOrderId: writing.loading ? expiringId : null, error: writing.error ?? reading.error,
    refresh, expire, resetError: () => { writing.reset(); readingStore.resetError(); },
  };
}
