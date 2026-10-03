import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { forbidden, internal } from "./errors.ts";

// The service client and verified actor must come from createEdgeHandler.
// Neither a client-supplied orgId nor user_metadata grants membership.
export async function assertOrganizationManager(
  serviceClient: SupabaseClient,
  orgId: string,
  actorId: string,
): Promise<void> {
  const { data, error } = await serviceClient.from("organization_members")
    .select("role").eq("org_id", orgId).eq("user_id", actorId).maybeSingle();
  if (error) throw internal("MEMBERSHIP_LOAD_FAILED");
  if (!data) throw forbidden();
  const parsed = z.object({ role: z.enum(["owner", "admin"]) }).safeParse(data);
  if (!parsed.success) throw forbidden();
}
