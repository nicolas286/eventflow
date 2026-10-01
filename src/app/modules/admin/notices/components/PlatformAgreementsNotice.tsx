import { canManagePlatformAgreements, platformAgreementsCurrent, type PlatformAgreementAccess, type PlatformAgreementVersions } from "../../organization/helpers/platformAgreements";
import { Notice } from "./Notice";

export function PlatformAgreementsNotice({ bootstrap }: { bootstrap: PlatformAgreementAccess & { organizationProfile: PlatformAgreementVersions | null } }) {
  if (!canManagePlatformAgreements(bootstrap) || platformAgreementsCurrent(bootstrap.organizationProfile)) return null;
  return <div className="adminNotices"><Notice key="platform-agreements"
    title="Action requise : documents Eventflow actualisés"
    body="Consultez et validez les nouvelles CGU, l’annexe Connect et l’accord de traitement des données, puis confirmez avoir pris connaissance de la politique de confidentialité."
    to="/admin/structure#platform-agreements" cta="Consulter et valider" /></div>;
}
