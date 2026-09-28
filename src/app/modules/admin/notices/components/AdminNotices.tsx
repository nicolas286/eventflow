import type { DashboardBootstrap } from "../../dashboard/schemas/admin.dashboardBootstrap.schema";
import { Notice, type NoticeProps } from "./Notice";
import { isBlank } from "@helpers/fields";

type Props = {
  bootstrap: DashboardBootstrap;
  className?: string;
};

export function AdminNotices({ bootstrap, className }: Props) {
  const notices: NoticeProps[] = [];

  const openInvoice = bootstrap.latestOpenInvoice;
  if (openInvoice) {
    const dueDate = new Date(openInvoice.dueAt).toLocaleDateString("fr-BE");
    const amount = (openInvoice.totalCents / 100).toLocaleString("fr-BE", {
      style: "currency",
      currency: openInvoice.currency,
    });
    notices.push({
      key: `invoice-${openInvoice.id}`,
      title: "Nouvelle facture Eventflow",
      body: `La facture ${openInvoice.number} de ${amount} est payable par virement avant le ${dueDate}.`,
      to: "/admin/abonnement?tab=invoices",
      cta: "Voir la facture",
    });
  }

  const plan = bootstrap.organization?.plan ?? "free";

  if (plan === "free") {
    notices.push({
      key: "plan-free",
      title: "Plan Free",
      body: "Certaines options sont limitées (branding, etc.). Passez en Starter/Pro pour débloquer.",
      to: "/admin/abonnement",
      cta: "Voir les plans",
    });
  }

  const p = bootstrap.profile;
  const addressMissing =
    isBlank(p.addressLine1) ||
    isBlank(p.postalCode) ||
    isBlank(p.city) ||
    isBlank(p.countryCode);

  if (addressMissing) {
    notices.push({
      key: "profile-address",
      title: "Profil incomplet",
      body: "Ajoutez votre adresse à votre profil.",
      to: "/admin/profil",
      cta: "Compléter mon profil",
    });
  }

  const op = bootstrap.organizationProfile;
  const orgDescriptionMissing = !op || isBlank(op.description);

  if (orgDescriptionMissing) {
    notices.push({
      key: "org-description",
      title: "Structure à compléter",
      body: "Ajoutez une description de votre organisation, visible sur votre page publique.",
      to: "/admin/structure",
      cta: "Compléter la structure",
    });
  }

  if (notices.length === 0) return null;

  return (
    <div className={["adminNotices", className].filter(Boolean).join(" ")}>
      {notices.map((n) => (
        <Notice
          key={n.key}
          title={n.title}
          body={n.body}
          to={n.to}
          cta={n.cta}
        />
      ))}
    </div>
  );
}
