import type { DashboardBootstrap } from "../../dashboard/schemas/admin.dashboardBootstrap.schema";
import { Notice } from "./Notice";

export function StripeMigrationNotice({
  bootstrap,
}: {
  bootstrap: DashboardBootstrap;
}) {
  const organization = bootstrap.organization;
  if (bootstrap.profile.stripeConnectAllowed !== true) {
    return (
      <div className="adminNotices">
        <Notice
          key="payments-unavailable"
          title="Paiements temporairement indisponibles"
          body="La vente de billets payants est désactivée pour votre organisation pendant la migration de notre prestataire de paiement. Les billets gratuits restent disponibles."
          to="/admin/structure"
          cta="Voir les paiements"
        />
      </div>
    );
  }

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

  if (stripeReady) return null;

  return (
    <div className="adminNotices">
      <Notice
        key="stripe-migration"
        title="Action requise : configurez Stripe"
        body={wasOnboardedWithMollie
          ? "Votre ancien onboarding Mollie ne permet plus d’encaisser. Terminez l’onboarding Stripe : les événements payants restent bloqués jusque-là."
          : "Votre organisation est autorisée à activer les paiements. Terminez l’onboarding Stripe avant de vendre des billets payants."}
        to="/admin/structure"
        cta="Configurer Stripe"
      />
    </div>
  );
}
