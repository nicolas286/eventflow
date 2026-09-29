import { forbidden, internal } from "../errors.ts";
import type { AdminClient } from "../supabase.ts";

export async function assertStripeConnectAllowedForUser(
  admin: AdminClient,
  userId: string,
) {
  const { data: profile, error } = await admin
    .from("user_profile")
    .select("stripe_connect_allowed")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw internal("STRIPE_ACCESS_CHECK_FAILED");
  if (profile?.stripe_connect_allowed !== true) {
    throw forbidden("STRIPE_CONNECT_NOT_ALLOWED");
  }
}

export async function isStripeConnectAllowedForOrganization(
  admin: AdminClient,
  creatorId: string | null,
) {
  if (!creatorId) return false;

  const { data: profile, error } = await admin
    .from("user_profile")
    .select("stripe_connect_allowed")
    .eq("user_id", creatorId)
    .maybeSingle();

  if (error) throw internal("STRIPE_ACCESS_CHECK_FAILED");
  return profile?.stripe_connect_allowed === true;
}
