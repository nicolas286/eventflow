import type { PlatformPublicConfig } from "@contracts/platform-admin";
import { isBlank } from "@helpers/fields";
import {
  DPA_VERSION,
  EVENTFLOW_CONNECT_TERMS_VERSION,
  EVENTFLOW_PLATFORM_TERMS_VERSION,
  EVENTFLOW_PRIVACY_VERSION,
} from "../../../../../shared/legal/documents";
import type { DashboardBootstrap } from "../dashboard/schemas/admin.dashboardBootstrap.schema";
import {
  canManagePlatformAgreements,
  platformAgreementsCurrent,
  type PlatformAgreementAccess,
  type PlatformAgreementVersions,
} from "../organization/helpers/platformAgreements";

export type AdminNotificationTone = "information" | "warning" | "critical";

export type AdminNotification = {
  id: string;
  title: string;
  body: string;
  tone: AdminNotificationTone;
  to?: string;
  cta?: string;
  dismissible: boolean;
};

export type AdminNotificationView = AdminNotification & {
  isRead: boolean;
};

type PlatformAgreementsBootstrap = PlatformAgreementAccess & {
  organizationProfile: PlatformAgreementVersions | null;
};

export function getPlatformAgreementNotification(
  bootstrap: PlatformAgreementsBootstrap,
): AdminNotification | null {
  if (
    !canManagePlatformAgreements(bootstrap) ||
    platformAgreementsCurrent(bootstrap.organizationProfile)
  ) {
    return null;
  }

  const version = [
    EVENTFLOW_PLATFORM_TERMS_VERSION,
    EVENTFLOW_CONNECT_TERMS_VERSION,
    DPA_VERSION,
    EVENTFLOW_PRIVACY_VERSION,
  ].join("-");

  return {
    id: `platform-agreements-${version}`,
    title: "Action requise : documents Eventflow actualisés",
    body: "Consultez et validez les nouvelles CGU, l’annexe Connect et l’accord de traitement des données, puis confirmez avoir pris connaissance de la politique de confidentialité.",
    tone: "critical",
    to: "/admin/structure#platform-agreements",
    cta: "Consulter et valider",
    dismissible: false,
  };
}

function getPaymentNotification(
  bootstrap: DashboardBootstrap,
): AdminNotification | null {
  const organization = bootstrap.organization;

  if (bootstrap.profile.stripeConnectAllowed !== true) {
    return {
      id: "payments-unavailable",
      title: "Paiements temporairement indisponibles",
      body: "La vente de billets payants est désactivée pour votre organisation pendant la migration de notre prestataire de paiement. Les billets gratuits restent disponibles.",
      tone: "warning",
      to: "/admin/structure",
      cta: "Voir les paiements",
      dismissible: true,
    };
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

  return {
    id: "stripe-migration",
    title: "Action requise : configurez Stripe",
    body: wasOnboardedWithMollie
      ? "Votre ancien onboarding Mollie ne permet plus d’encaisser. Terminez l’onboarding Stripe : les événements payants restent bloqués jusque-là."
      : "Votre organisation est autorisée à activer les paiements. Terminez l’onboarding Stripe avant de vendre des billets payants.",
    tone: "warning",
    to: "/admin/structure",
    cta: "Configurer Stripe",
    dismissible: true,
  };
}

export function getDashboardNotifications(
  bootstrap: DashboardBootstrap,
): AdminNotification[] {
  const notifications: AdminNotification[] = [];
  const agreementNotification = getPlatformAgreementNotification(bootstrap);
  const paymentNotification = getPaymentNotification(bootstrap);

  if (agreementNotification) notifications.push(agreementNotification);
  if (paymentNotification) notifications.push(paymentNotification);

  const openInvoice = bootstrap.latestOpenInvoice;
  if (openInvoice) {
    const dueDate = new Date(openInvoice.dueAt).toLocaleDateString("fr-BE");
    const amount = (openInvoice.totalCents / 100).toLocaleString("fr-BE", {
      style: "currency",
      currency: openInvoice.currency,
    });
    notifications.push({
      id: `invoice-${openInvoice.id}`,
      title: "Nouvelle facture Eventflow",
      body: `La facture ${openInvoice.number} de ${amount} est payable par virement avant le ${dueDate}.`,
      tone: "warning",
      to: "/admin/abonnement?tab=invoices",
      cta: "Voir la facture",
      dismissible: true,
    });
  }

  const profile = bootstrap.profile;
  const addressMissing =
    isBlank(profile.addressLine1) ||
    isBlank(profile.postalCode) ||
    isBlank(profile.city) ||
    isBlank(profile.countryCode);

  if (addressMissing) {
    notifications.push({
      id: "profile-address",
      title: "Profil incomplet",
      body: "Ajoutez votre adresse à votre profil.",
      tone: "information",
      to: "/admin/profil",
      cta: "Compléter mon profil",
      dismissible: true,
    });
  }

  const organizationProfile = bootstrap.organizationProfile;
  if (!organizationProfile || isBlank(organizationProfile.description)) {
    notifications.push({
      id: "org-description",
      title: "Profil organisateur à compléter",
      body: "Ajoutez une description de votre organisation, visible sur votre page publique.",
      tone: "information",
      to: "/admin/structure",
      cta: "Compléter le profil",
      dismissible: true,
    });
  }

  if ((bootstrap.organization?.plan ?? "free") === "free") {
    notifications.push({
      id: "plan-free",
      title: "Plan Free",
      body: "Certaines options sont limitées. Consultez les offres Starter et Pro pour les débloquer.",
      tone: "information",
      to: "/admin/abonnement",
      cta: "Voir les offres",
      dismissible: true,
    });
  }

  return notifications;
}

export function getPlatformNotifications(
  config: PlatformPublicConfig | null,
): AdminNotification[] {
  if (!config) return [];

  const notifications: AdminNotification[] = [];
  const announcement = config.announcement;

  if (announcement) {
    notifications.push({
      id: `platform-announcement-${announcement.id}`,
      title: announcement.title,
      body: announcement.body,
      tone:
        announcement.level === "maintenance" ? "critical" : announcement.level,
      dismissible: true,
    });
  }

  if (!config.registrationsOpen) {
    notifications.push({
      id: `registrations-closed-${config.registrationPublicMessage}`,
      title: "Inscriptions temporairement fermées",
      body: config.registrationPublicMessage,
      tone: "critical",
      dismissible: true,
    });
  }

  return notifications;
}
