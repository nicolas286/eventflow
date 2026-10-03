import { useMemo, useSyncExternalStore } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeOrganizationBillingRepo } from "../data/makeOrganizationBillingRepo";
import type { OrganizationBillingPatch } from "@shared/models/db/db.organizationBilling.schema";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import { createOrganizationBillingStore } from "./useMakeOrganizationBilling";

export function useUpsertOrganizationBilling(params: { supabase: SupabaseClient; orgId?: string }) {
  const { supabase, orgId } = params;
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);
  const repo = useMemo(() => makeOrganizationBillingRepo(supabase), [supabase]);
  const store = useMemo(() => createOrganizationBillingStore(
    (input: OrganizationBillingPatch) => repo.upsertOrganizationBilling(input),
    "Impossible de Enregistrer les infos de facturation",
    sessionScope !== null,
    orgId,
  ), [repo, sessionScope, orgId]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  return {
    loading: state.loading,
    error: state.error,
    updated: state.loading ? null : state.billing,
    upsertOrganizationBilling: store.load,
    reset: store.reset,
    isCurrentScope: store.isCurrentScope,
  };
}
