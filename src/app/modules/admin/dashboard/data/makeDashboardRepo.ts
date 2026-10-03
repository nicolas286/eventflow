import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { dashboardRequestSchema } from "@contracts/organizations";
import { dashboardBootstrapSchema, type DashboardBootstrap } from "../schemas/admin.dashboardBootstrap.schema";

export function makeDashboardRepo(supabase: SupabaseClient) {
  return {
    async getDashboardBootstrap(orgId?: string): Promise<DashboardBootstrap | null> {
      const body = dashboardRequestSchema.parse(orgId === undefined ? {} : { orgId });
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organizations/bootstrap", { body })
      );
      return dashboardBootstrapSchema.parse(raw);
    },
  };
}
