import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  publicOrgRequestSchema,
  publicOrgBySlugSchema,
} from "@contracts/public-catalog";
export function makePublicOrgRepo(supabase: SupabaseClient) {
  return {
    async getPublicOrgBySlug(slug: string) {
      const body = publicOrgRequestSchema.parse({ orgSlug: slug });
      const result = publicOrgBySlugSchema.parse(
        await edgeSafe<unknown>(() =>
          supabase.functions.invoke("events/public/org", { body }),
        ),
      );
      if (result.profile.slug !== body.orgSlug)
        throw new Error("CATALOG_SCOPE_INVALID");
      return result;
    },
  };
}
