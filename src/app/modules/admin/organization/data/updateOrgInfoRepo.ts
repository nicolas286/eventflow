import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { updateOrganizationRequestSchema, updateOrganizationResponseSchema } from "@contracts/organizations";
import type { UpdateOrgInfoPatch, UpdateOrgInfoResult } from "../schemas/admin.updateOrgPatch.schema";

export function updateOrgInfoRepo(supabase: SupabaseClient) {
  return {
    async updateOrgInfo(input: UpdateOrgInfoPatch): Promise<UpdateOrgInfoResult> {
      const body = updateOrganizationRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organizations/update", { body })
      );
      return updateOrganizationResponseSchema.parse(raw);
    },
  };
}
