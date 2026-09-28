import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeError } from "@errors/errors";
import { stripeConnectRepo } from "../data/stripeConnectRepo";
import type { StripeConnectStatus } from "../schemas/admin.stripeConnect.schema";

export function useStripeConnect(params: { supabase: SupabaseClient }) {
  const repo = useMemo(
    () => stripeConnectRepo(params.supabase),
    [params.supabase],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StripeConnectStatus | null>(null);

  async function start(orgId: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await repo.start({ orgId });
      return result.url;
    } catch (cause) {
      setError(
        normalizeError(cause, "Impossible de lancer Stripe Connect").message,
      );
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function refreshStatus(orgId: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await repo.status({ orgId });
      setStatus(result);
      return result;
    } catch (cause) {
      setError(
        normalizeError(cause, "Impossible de vérifier le compte Stripe")
          .message,
      );
      return null;
    } finally {
      setLoading(false);
    }
  }

  return { loading, error, status, start, refreshStatus };
}
