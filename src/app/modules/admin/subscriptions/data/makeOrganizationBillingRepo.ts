import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  billingRequestSchema,
  billingReadResponseSchema,
  organizationBillingPatchSchema,
  organizationBillingSchema,
  type OrganizationBilling,
  type OrganizationBillingPatch,
} from "@contracts/organization-billing";

export function makeOrganizationBillingRepo(supabase: SupabaseClient) {
  return {
    async getOrganizationBilling(orgId: string): Promise<OrganizationBilling | null> {
      const body = billingRequestSchema.parse({ orgId });
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organizations/billing/read", { body }),
      );
      return billingReadResponseSchema.parse(raw).billing;
    },

    async upsertOrganizationBilling(input: OrganizationBillingPatch): Promise<OrganizationBilling> {
      const body = organizationBillingPatchSchema.parse(input);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organizations/billing/update", { body }),
      );
      return organizationBillingSchema.parse(raw);
    },
  };
}
