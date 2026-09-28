import type { DashboardBootstrap } from "../../dashboard/schemas/admin.dashboardBootstrap.schema";
import { Notice } from "./Notice";

export function StripeMigrationNotice({
  bootstrap,
}: {
  bootstrap: DashboardBootstrap;
}) {
  const organization = bootstrap.organization;
  const wasOnboardedWithMollie =
    organization?.stripeMigrationRequired === true ||
    (organization?.paymentsProvider === "mollie" &&
      organization.paymentsStatus !== "not_connected");
  const stripeReady = Boolean(
    organization?.stripeConnectedAccountId &&
    organization.stripeDetailsSubmitted &&
    organization.stripeChargesEnabled &&
    organization.stripePayoutsEnabled,
  );

  if (!wasOnboardedWithMollie || stripeReady) return null;

  return (
    <div className="adminNotices">
      <Notice
        key="stripe-migration"
        title="Action requise : configurez Stripe"
        body="Votre ancien onboarding Mollie, en test comme en live, ne permet plus d’encaisser. Terminez l’onboarding Stripe : les événements payants restent bloqués jusque-là."
        to="/admin/structure"
        cta="Configurer Stripe"
      />
    </div>
  );
}
