import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  publicEventRequestSchema,
  publicEventDetailSchema,
} from "@contracts/public-catalog";
export function makePublicEventDetailRepo(supabase: SupabaseClient) {
  return {
    async getPublicEventDetail(orgSlug: string, eventSlug: string) {
      const body = publicEventRequestSchema.parse({ orgSlug, eventSlug });
      const result = publicEventDetailSchema.parse(
        await edgeSafe<unknown>(() =>
          supabase.functions.invoke("events/public/detail", { body }),
        ),
      );
      if (
        result.org.slug !== body.orgSlug ||
        result.event.slug !== body.eventSlug
      )
        throw new Error("CATALOG_SCOPE_INVALID");
      return result;
    },
  };
}
