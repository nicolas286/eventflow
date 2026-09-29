import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeError } from "@errors/errors";
import type { BankTransferAdminSummary } from "@contracts/bank-transfer";
import { bankTransferAdminRepo } from "../data/bankTransferAdminRepo";

export function useBankTransferAdmin(input: {
  supabase: SupabaseClient;
  eventId: string;
}) {
  const repo = useMemo(
    () => bankTransferAdminRepo(input.supabase),
    [input.supabase],
  );
  const [summaries, setSummaries] = useState<BankTransferAdminSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expiringOrderId, setExpiringOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!input.eventId) return;

    try {
      setLoading(true);
      setError(null);
      setSummaries(await repo.list(input.eventId));
    } catch (caught) {
      setError(
        normalizeError(
          caught,
          "Impossible de charger les virements bancaires",
        ).message,
      );
    } finally {
      setLoading(false);
    }
  }, [input.eventId, repo]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const expire = useCallback(
    async (orderId: string) => {
      try {
        setExpiringOrderId(orderId);
        setError(null);
        const result = await repo.expire(orderId);
        await refresh();
        return result;
      } catch (caught) {
        setError(
          normalizeError(
            caught,
            "Impossible d’expirer la réservation",
          ).message,
        );
        return null;
      } finally {
        setExpiringOrderId(null);
      }
    },
    [refresh, repo],
  );

  const resetError = useCallback(() => setError(null), []);

  return {
    summaries,
    loading,
    expiringOrderId,
    error,
    refresh,
    expire,
    resetError,
  };
}
