import type { ConnectedAccountStatus } from "./provider.ts";
import type { AdminClient } from "../supabase.ts";

export function isStripeAccountReady(status: ConnectedAccountStatus) {
  return (
    status.configurationSupported &&
    !status.requirementsDisabledReason &&
    status.requirementsCurrentlyDue.length === 0 &&
    status.detailsSubmitted &&
    status.chargesEnabled &&
    status.payoutsEnabled
  );
}

export async function persistStripeAccountStatus(
  admin: AdminClient,
  orgId: string,
  status: ConnectedAccountStatus,
  options: { selectProvider?: boolean; expectedAccountId: string | null },
) {
  const ready = isStripeAccountReady(status);
  const { data: organization, error: loadError } = await admin
    .from("organizations")
    .select("payments_provider, stripe_connected_account_id")
    .eq("id", orgId)
    .maybeSingle();
  if (loadError)
    throw new Error(loadError.message ?? "PAYMENT_PROVIDER_LOAD_FAILED");
  if (!organization ||
      organization.stripe_connected_account_id !== options.expectedAccountId ||
      (options.expectedAccountId !== null &&
        status.providerAccountId !== options.expectedAccountId)) {
    throw new Error("STRIPE_ACCOUNT_CHANGED");
  }

  const shouldReflectAsActive =
    options.selectProvider === true ||
    organization?.payments_provider === "stripe";
  const values: Record<string, unknown> = {
    stripe_connected_account_id: status.providerAccountId,
    stripe_account_type: status.accountType,
    stripe_controller_fees_payer: status.controllerFeesPayer,
    stripe_controller_losses_payments: status.controllerLossesPayments,
    stripe_controller_requirement_collection:
      status.controllerRequirementCollection,
    stripe_controller_dashboard_type: status.controllerDashboardType,
    stripe_requirements_disabled_reason: status.requirementsDisabledReason,
    stripe_requirements_currently_due: status.requirementsCurrentlyDue,
    stripe_compliance_verified: status.configurationSupported,
    stripe_details_submitted: status.detailsSubmitted,
    stripe_charges_enabled: status.chargesEnabled,
    stripe_payouts_enabled: status.payoutsEnabled,
    payments_account_updated_at: new Date().toISOString(),
  };

  values.stripe_migration_required = !status.configurationSupported;
  if (status.configurationSupported) values.stripe_deauthorized_at = null;

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

  const update = admin
    .from("organizations")
    .update(values)
    .eq("id", orgId);
  const { data: saved, error } = await (options.expectedAccountId === null
    ? update.is("stripe_connected_account_id", null)
    : update.eq("stripe_connected_account_id", options.expectedAccountId))
    .select("id")
    .maybeSingle();

  if (error)
    throw new Error(error.message ?? "STRIPE_ACCOUNT_STATUS_SAVE_FAILED");
  if (!saved) throw new Error("STRIPE_ACCOUNT_CHANGED");

  return ready;
}
