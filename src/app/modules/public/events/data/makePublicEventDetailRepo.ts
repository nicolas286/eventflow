import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseSafe } from "@gateways/supabase/supabaseSafe";
import { snakeToCamel } from "@helpers/snakeToCamel";
import {
  publicEventDetailSchema,
  type PublicEventDetail,
} from "../schemas/public.eventDetailBySlug.schema";

export function makePublicEventDetailRepo(supabase: SupabaseClient) {
  return {
    async getPublicEventDetail(
      orgSlug: string,
      eventSlug: string,
    ): Promise<PublicEventDetail> {
      const [raw, organizerTerms] = await Promise.all([
        supabaseSafe(() =>
          supabase.rpc("get_public_event_detail", {
            p_org_slug: orgSlug,
            p_event_slug: eventSlug,
          }),
        ),
        supabaseSafe(() =>
          supabase.rpc("get_public_organization_sales_terms", {
            p_org_slug: orgSlug,
          }),
        ),
      ]);

      const camel = snakeToCamel(raw) as Record<string, unknown> & {
        org?: Record<string, unknown>;
      };
      const terms = snakeToCamel(organizerTerms) as Record<string, unknown>;
      return publicEventDetailSchema.parse({
        ...camel,
        org: {
          ...camel.org,
          ...terms,
        },
      });
    },
  };
}
