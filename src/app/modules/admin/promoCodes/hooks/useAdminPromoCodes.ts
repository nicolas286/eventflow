import { useMemo, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminPromoCodesRepo } from "../data/promoCodeRepo";
import { normalizeError } from "@errors/errors";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import type {
  DbPromoCode, CreatePromoCodeInput, UpdatePromoCodePatch, DeletePromoCodeInput,
} from "@contracts/promo-codes";

type State = {
  loading: boolean; saving: boolean; deleting: boolean;
  error: string | null; promoCodes: DbPromoCode[];
};
type PromoRepository = ReturnType<typeof adminPromoCodesRepo>;

export function createAdminPromoCodesStore(
  repo: PromoRepository,
  scope: { orgId: string; eventId: string },
  enabled = true,
) {
  const empty: State = { loading: false, saving: false, deleting: false, error: null, promoCodes: [] };
  let state = empty;
  let generation = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  const isCurrentScope = () => enabled && listeners.size > 0;
  const reset = () => { generation++; state = empty; emit(); };
  const matchesScope = (row: DbPromoCode) => row.orgId === scope.orgId && row.eventId === scope.eventId;

  async function run<Result>(
    flag: "loading" | "saving" | "deleting",
    operation: () => Promise<Result>,
    apply: (result: Result, current: State) => DbPromoCode[],
    fallback: Result,
    errorMessage: string,
  ): Promise<Result> {
    if (!isCurrentScope()) return fallback;
    const request = ++generation;
    const isCurrent = () => request === generation && isCurrentScope();
    state = { ...state, loading: false, saving: false, deleting: false, [flag]: true, error: null };
    emit();
    try {
      const result = await operation();
      if (!isCurrent()) return fallback;
      const promoCodes = apply(result, state);
      state = { ...empty, promoCodes };
      emit();
      return result;
    } catch (error: unknown) {
      if (!isCurrent()) return fallback;
      state = { ...state, loading: false, saving: false, deleting: false, error: normalizeError(error, errorMessage).message };
      emit();
      return fallback;
    }
  }
  const validateRow = (row: DbPromoCode) => {
    if (!matchesScope(row)) throw new Error("RESOURCE_SCOPE_MISMATCH");
    return row;
  };

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); if (listeners.size === 0) reset(); };
    },
    getSnapshot: () => state,
    getError: () => state.error,
    getGeneration: () => generation,
    isCurrentScope,
    reset,
    clearError() { state = { ...state, error: null }; emit(); },
    loadPromoCodes(input: { eventId: string }): Promise<DbPromoCode[]> {
      if (input.eventId !== scope.eventId) return Promise.resolve([]);
      return run("loading", () => repo.listEventPromoCodes(input), (rows) => rows.map(validateRow), [], "Impossible de charger les codes promo");
    },
    createPromoCode(input: CreatePromoCodeInput): Promise<DbPromoCode | null> {
      if (input.orgId !== scope.orgId || input.eventId !== scope.eventId) return Promise.resolve(null);
      return run<DbPromoCode | null>("saving", () => repo.createPromoCode(input), (row, current) => {
        if (!row) return current.promoCodes;
        validateRow(row);
        return [row, ...current.promoCodes.filter((code) => code.id !== row.id)];
      }, null, "Impossible de créer le code promo");
    },
    updatePromoCode(input: { promoCodeId: string; patch: UpdatePromoCodePatch }): Promise<DbPromoCode | null> {
      return run<DbPromoCode | null>("saving", () => repo.updatePromoCode(input), (row, current) => {
        if (!row) return current.promoCodes;
        validateRow(row);
        if (row.id !== input.promoCodeId) throw new Error("RESOURCE_SCOPE_MISMATCH");
        return current.promoCodes.map((code) => code.id === row.id ? row : code);
      }, null, "Impossible de modifier le code promo");
    },
    deletePromoCode(input: DeletePromoCodeInput): Promise<boolean> {
      return run("deleting", async () => { await repo.deletePromoCode(input); return true; },
        (_result, current) => current.promoCodes.filter((code) => code.id !== input.id),
        false, "Impossible de supprimer le code promo");
    },
  };
}

export function useAdminPromoCodes(params: { supabase: SupabaseClient; orgId?: string | null; eventId?: string }) {
  const { supabase, orgId, eventId } = params;
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);
  const repo = useMemo(() => adminPromoCodesRepo(supabase), [supabase]);
  const store = useMemo(() => createAdminPromoCodesStore(repo,
    { orgId: orgId ?? "", eventId: eventId ?? "" }, sessionScope !== null && !!orgId && !!eventId),
  [repo, sessionScope, orgId, eventId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return {
    ...state, loadPromoCodes: store.loadPromoCodes, createPromoCode: store.createPromoCode,
    updatePromoCode: store.updatePromoCode, deletePromoCode: store.deletePromoCode,
    reset: store.reset, clearError: store.clearError, isCurrentScope: store.isCurrentScope,
    getError: store.getError, getGeneration: store.getGeneration,
  };
}
