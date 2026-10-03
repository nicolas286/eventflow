import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { createOrganizationRequestSchema, createOrganizationResponseSchema } from "@contracts/organizations";
import type { CreateOrganizationForm, CreateOrganizationResult } from "../schemas/admin.createOrganization.schema";

export function createOrganizationsRepo(supabase: SupabaseClient) {
  return {
    async createOrganization(input: CreateOrganizationForm): Promise<CreateOrganizationResult> {
      const body = createOrganizationRequestSchema.parse(input);
      const rawOrgId = await edgeSafe<unknown>(
        () => supabase.functions.invoke("organizations/create", { body }),
      );

      return createOrganizationResponseSchema.parse(rawOrgId);
    },
  };
}
