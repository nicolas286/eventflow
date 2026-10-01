import { canManagePlatformAgreements } from "../helpers/platformAgreements";
import { useOutletContext } from "react-router-dom";

import { Container } from "@ui/components";
import Card, { CardBody, CardHeader } from "@ui/components/card/Card";

import StructurePanel from "../components/OrganizationPanel/OrganizationPanel";
import type { AdminOutletContext } from "../../dashboard/components/AdminDashboard";
import { AdminPageHeader } from "../../dashboard/components/AdminPageHeader/AdminPageHeader";

export default function AdminStructurePage() {
  const { bootstrap, orgId, refetch } = useOutletContext<AdminOutletContext>();

  const ready = !!bootstrap && !!orgId;

  return (
    <Container>
      <AdminPageHeader
        eyebrow="Organisation"
        title="Profil organisateur"
        description="Centralisez les informations publiques de votre structure et la configuration nécessaire à l’encaissement de vos ventes."
      />
      <Card>
        <CardHeader
          title="Informations de l’organisation"
          subtitle="Coordonnées publiques, présentation et configuration des paiements."
        />
        <CardBody>
          {!ready ? (
            <div className="adminCard">
              <p>Chargement…</p>
            </div>
          ) : (
            <StructurePanel
              orgId={orgId}
              orgInfo={bootstrap.organization}
              orgProfile={bootstrap.organizationProfile}
              stripeConnectAllowed={bootstrap.profile.stripeConnectAllowed}
              canManageAgreements={canManagePlatformAgreements(bootstrap)}
              onSaved={refetch}
            />
          )}
        </CardBody>
      </Card>
    </Container>
  );
}
