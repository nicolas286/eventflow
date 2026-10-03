import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  publicEventsPageRequestSchema,
  publicEventsPageSchema,
  publicOrgEventsOverviewSchema,
  type PublicEventOverview,
} from "@contracts/public-catalog";
export function makePublicEventsOverviewRepo(supabase: SupabaseClient) {
  return {
    async getPublicOrgEventsOverview(orgSlug: string) {
      const events: PublicEventOverview[] = [],
        seen = new Set<string>();
      let after: string | null = null;
      do {
        const body = publicEventsPageRequestSchema.parse({
          orgSlug,
          limit: 100,
          after,
        });
        const page = publicEventsPageSchema.parse(
          await edgeSafe<unknown>(() =>
            supabase.functions.invoke("events/public/overview", { body }),
          ),
        );
        if (page.orgSlug !== body.orgSlug)
          throw new Error("CATALOG_SCOPE_INVALID");
        for (const event of page.events) {
          if (seen.has(event.id)) throw new Error("CATALOG_CURSOR_INVALID");
          seen.add(event.id);
          events.push(event);
        }
        if (page.nextCursor && page.nextCursor !== page.events.at(-1)?.id)
          throw new Error("CATALOG_CURSOR_INVALID");
        after = page.nextCursor;
      } while (after);
      return publicOrgEventsOverviewSchema.parse({
        orgSlug: orgSlug.trim(),
        events,
      });
    },
  };
}
