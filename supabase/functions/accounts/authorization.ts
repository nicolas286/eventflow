import type { SupabaseClient } from "@supabase/supabase-js";

/** Must run before any provider call, organisation update or user deletion. */
export async function authorizeAccountOrganization(
  service: SupabaseClient,
  userId: string,
  requestedOrgId?: string,
) {
  let query = service.from("organization_members").select("org_id, role")
    .eq("user_id", userId).in("role", ["owner", "admin"]);
  if (requestedOrgId) query = query.eq("org_id", requestedOrgId);
  const { data, error } = await query.limit(1).maybeSingle();
  if (error) return { ok: false as const, error: "Load membership failed", status: 500 };
  if (!data?.org_id) return {
    ok: false as const,
    error: requestedOrgId ? "FORBIDDEN" : "NO_ORG_FOUND",
    status: requestedOrgId ? 403 : 404,
  };
  return { ok: true as const, orgId: String(data.org_id) };
}
