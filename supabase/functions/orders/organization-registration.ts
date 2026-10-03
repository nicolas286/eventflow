import type { SupabaseClient } from "@supabase/supabase-js";
import { forbidden, internal, notFound } from "../_shared/errors.ts";

/** Only new registrations are gated; existing orders keep their lifecycle. */
export async function assertOrganizationRegistrationsAllowed(
  admin: SupabaseClient,
  orgId: string,
) {
  const { data, error } = await admin.from("organizations").select("status")
    .eq("id", orgId).maybeSingle();
  if (error) throw internal("ORGANIZATION_STATUS_UNAVAILABLE");
  if (!data) throw notFound("ORGANIZATION_NOT_FOUND");
  if (data.status === "suspended") throw forbidden("ORGANIZATION_SUSPENDED");
  if (data.status !== "active" && data.status !== "trial") {
    throw internal("ORGANIZATION_STATUS_UNAVAILABLE");
  }
}
