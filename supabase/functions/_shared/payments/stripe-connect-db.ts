import type { ConnectedAccountStatus } from "./provider.ts";
import type { AdminClient } from "../supabase.ts";

export function isStripeAccountReady(status: ConnectedAccountStatus) {
  return (
    status.detailsSubmitted && status.chargesEnabled && status.payoutsEnabled
  );
}

export async function persistStripeAccountStatus(
  admin: AdminClient,
  orgId: string,
  status: ConnectedAccountStatus,
  options: { selectProvider?: boolean } = {},
) {
  const ready = isStripeAccountReady(status);
  const { data: organization, error: loadError } = await admin
    .from("organizations")
    .select("payments_provider")
    .eq("id", orgId)
    .maybeSingle();
  if (loadError)
    throw new Error(loadError.message ?? "PAYMENT_PROVIDER_LOAD_FAILED");

  const shouldReflectAsActive =
    options.selectProvider === true ||
    organization?.payments_provider === "stripe";
  const values: Record<string, unknown> = {
    stripe_connected_account_id: status.providerAccountId,
    stripe_details_submitted: status.detailsSubmitted,
    stripe_charges_enabled: status.chargesEnabled,
    stripe_payouts_enabled: status.payoutsEnabled,
    payments_account_updated_at: new Date().toISOString(),
  };

  if (ready) values.stripe_migration_required = false;

  if (shouldReflectAsActive) {
    values.payments_provider = "stripe";
    values.payments_status = ready
      ? "connected"
      : status.detailsSubmitted
        ? "pending"
        : "not_connected";
    values.payments_live_ready = ready;
    values.payments_details_submitted = status.detailsSubmitted;
  }

  const { error } = await admin
    .from("organizations")
    .update(values)
    .eq("id", orgId);

  if (error)
    throw new Error(error.message ?? "STRIPE_ACCOUNT_STATUS_SAVE_FAILED");

  return ready;
}
