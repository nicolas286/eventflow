import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeError } from "@errors/errors";
import { markBankTransferPaidRepo } from "../data/markBankTransferPaidRepo";

export function useMarkBankTransferPaid(input: { supabase: SupabaseClient }) {
  const repo = useMemo(
    () => markBankTransferPaidRepo(input.supabase),
    [input.supabase],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function markPaid(orderId: string) {
    try {
      setLoading(true);
      setError(null);
      return await repo.markPaid(orderId);
    } catch (caught) {
      setError(
        normalizeError(caught, "Impossible de confirmer le virement").message,
      );
      return null;
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setError(null);
  }

  return { loading, error, markPaid, reset };
}
