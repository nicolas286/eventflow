import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createCancelSubscriptionRepo } from "../data/cancelSubscriptionRepo";
import type { CancelSubscriptionPayload, 
  CancelSubscriptionResponse } from "../schemas/admin.cancelSubscription.schema";
import { normalizeError } from "@errors/errors";

/* ------------------------------------------------------------------ */
/* State                                                              */
/* ------------------------------------------------------------------ */

type State = {
  loading: boolean;
  error: string | null;
  result: CancelSubscriptionResponse | null;
};

/* ------------------------------------------------------------------ */
/* Hook                                                               */
/* ------------------------------------------------------------------ */

export function useCancelSubscription(params: { supabase: SupabaseClient }) {
  const { supabase } = params;

  const repo = useMemo(() => createCancelSubscriptionRepo(supabase), [supabase]);

  const [state, setState] = useState<State>({
    loading: false,
    error: null,
    result: null,
  });

  async function cancelSubscription(
    input: CancelSubscriptionPayload,
  ): Promise<CancelSubscriptionResponse | null> {
    try {
      setState({ loading: true, error: null, result: null });

      const result = await repo.cancelSubscription(input);

      if (!result.ok) {
        throw new Error("Impossible de résilier l’abonnement. Réessayez dans quelques instants.");
      }

      setState({ loading: false, error: null, result });
      return result;
    } catch (e: unknown) {
      const ne = normalizeError(e, "Impossible de résilier l’abonnement.");

      setState({ loading: false, error: ne.message, result: null });
      return null;
    }
  }

  function reset() {
    setState({ loading: false, error: null, result: null });
  }

  return {
    ...state,
    cancelSubscription,
    reset,
  };
}
