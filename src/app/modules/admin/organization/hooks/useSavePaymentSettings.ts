import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeError } from "@errors/errors";
import { updatePaymentSettingsRepo } from "../data/updatePaymentSettingsRepo";
import type {
  UpdatePaymentSettingsInput,
  UpdatePaymentSettingsResult,
} from "../schemas/admin.updatePaymentSettings.schema";

export function useSavePaymentSettings(input: { supabase: SupabaseClient }) {
  const repo = useMemo(
    () => updatePaymentSettingsRepo(input.supabase),
    [input.supabase],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<UpdatePaymentSettingsResult | null>(
    null,
  );

  async function save(values: UpdatePaymentSettingsInput) {
    try {
      setLoading(true);
      setError(null);
      setUpdated(null);
      const result = await repo.update(values);
      setUpdated(result);
      return result;
    } catch (caught) {
      setError(
        normalizeError(caught, "Impossible d’enregistrer le mode de paiement")
          .message,
      );
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function read(orgId: string) {
    try {
      setLoading(true);
      setError(null);
      return await repo.read(orgId);
    } catch (caught) {
      setError(
        normalizeError(caught, "Impossible d’afficher les coordonnées bancaires")
          .message,
      );
      return null;
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setError(null);
    setUpdated(null);
  }

  return { loading, error, updated, save, read, reset };
}
