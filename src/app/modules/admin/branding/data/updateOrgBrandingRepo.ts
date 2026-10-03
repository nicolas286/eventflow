import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { brandingSchema, updateBrandingRequestSchema } from "@contracts/organizations";
import type { OrgBranding, UpdateOrgBrandingInput } from "../schemas/admin.orgBranding.schema";

export function updateOrgBrandingRepo(supabase: SupabaseClient) {
  return {
    async updateOrgBranding(input: UpdateOrgBrandingInput): Promise<OrgBranding> {
      const body = updateBrandingRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organizations/branding", { body })
      );
      return brandingSchema.parse(raw);
    },
  };
}
