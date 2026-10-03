import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { updateProfileRequestSchema } from "@contracts/organizations";
import { profileSchema, type Profile } from "@contracts/organization-data";
import type { UpdateAdminProfileInput } from "../schemas/admin.updateAdminProfile.schema";

export function updateAdminProfileRepo(supabase: SupabaseClient) {
  return {
    async updateAdminProfile(input: UpdateAdminProfileInput): Promise<Profile> {
      const body = updateProfileRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organizations/profile", { body })
      );
      return profileSchema.parse(raw);
    },
  };
}
