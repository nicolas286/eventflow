import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sellerComplianceRepo, type SellerIdentityInput } from "../data/sellerComplianceRepo";
import { normalizeError } from "@errors/errors";

export function useSellerCompliance(supabase: SupabaseClient) {
  const repo = useMemo(() => sellerComplianceRepo(supabase), [supabase]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function saveIdentity(orgId: string, identity: SellerIdentityInput) {
    setLoading(true);
    setError(null);
    try {
      await repo.saveIdentity(orgId, identity);
      return true;
    } catch (caught) {
      setError(normalizeError(caught, "Impossible d’enregistrer l’identité du vendeur.").message);
      return false;
    } finally { setLoading(false); }
  }
  async function acceptAgreements(orgId: string) {
    setLoading(true);
    setError(null);
    try {
      await repo.acceptAgreements(orgId);
      return true;
    } catch (caught) {
      setError(normalizeError(caught, "Impossible de valider les accords. Rechargez la page et relisez les documents.").message);
      return false;
    } finally { setLoading(false); }
  }
  return { loading, error, saveIdentity, acceptAgreements };
}
