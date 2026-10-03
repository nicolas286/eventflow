import { useCallback, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makeInvoiceListRepo } from "../data/makeInvoiceListRepo";

import type { InvoiceHistoryItem } from "@contracts/invoice-history";
import { normalizeError } from "@errors/errors";

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

type Cursor = { issuedAt: string | null; id: string };

type State = {
  loading: boolean;
  error: string | null;
  items: InvoiceHistoryItem[];
  nextCursor: Cursor | null;
};

/* ------------------------------------------------------------------ */
/* Hook                                                                 */
/* ------------------------------------------------------------------ */

export function useMakeInvoiceList(params: { supabase: SupabaseClient }) {
  const { supabase } = params;

  const repo = useMemo(() => makeInvoiceListRepo(supabase), [supabase]);

  const [state, setState] = useState<State>({
    loading: false,
    error: null,
    items: [],
    nextCursor: null,
  });

  const fetchFirst = useCallback(
    async (input: { orgId: string; limit?: number }): Promise<InvoiceHistoryItem[]> => {
      try {
        setState((s) => ({ ...s, loading: true, error: null }));

        const res = await repo.listInvoices({
          orgId: input.orgId,
          limit: input.limit ?? 25,
          cursor: null,
        });

        setState({
          loading: false,
          error: null,
          items: res.items,
          nextCursor: res.nextCursor,
        });

        return res.items;
      } catch (e: unknown) {
        const ne = normalizeError(e, "Impossible de charger les factures");
        setState({ loading: false, error: ne.message, items: [], nextCursor: null });
        return [];
      }
    },
    [repo]
  );

  const fetchMore = useCallback(
    async (input: { orgId: string; limit?: number }): Promise<InvoiceHistoryItem[]> => {
      try {
        setState((s) => ({ ...s, loading: true, error: null }));

        const cursor = state.nextCursor;

        // sécurité : plus rien à charger
        if (!cursor) {
          setState((s) => ({ ...s, loading: false }));
          return state.items;
        }

        const res = await repo.listInvoices({
          orgId: input.orgId,
          limit: input.limit ?? 25,
          cursor,
        });

        setState((s) => ({
          loading: false,
          error: null,
          items: [...s.items, ...res.items],
          nextCursor: res.nextCursor,
        }));

        return res.items;
      } catch (e: unknown) {
        const ne = normalizeError(e, "Impossible de charger plus de factures");
        setState((s) => ({ ...s, loading: false, error: ne.message }));
        return state.items;
      }
    },
    [repo, state.nextCursor, state.items]
  );

  function reset() {
    setState({ loading: false, error: null, items: [], nextCursor: null });
  }

  return {
    ...state,
    fetchFirst,
    fetchMore,
    reset,
    hasMore: Boolean(state.nextCursor),
  };
}
