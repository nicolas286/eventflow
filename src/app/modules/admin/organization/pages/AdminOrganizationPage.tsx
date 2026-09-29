import { useOutletContext } from "react-router-dom";

import { Container } from "@ui/components";
import Card, { CardBody, CardHeader } from "@ui/components/card/Card";

import StructurePanel from "../components/OrganizationPanel/OrganizationPanel";
import type { AdminOutletContext } from "../../dashboard/components/AdminDashboard";

export default function AdminStructurePage() {
  const { bootstrap, orgId, refetch } = useOutletContext<AdminOutletContext>();

  const ready = !!bootstrap && !!orgId;

  return (
    <Container>
      <Card>
        <CardHeader
          title="Structure"
          subtitle="Gérez l’identité, les infos publiques et le fournisseur des paiements d’événements."
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
              onSaved={refetch}
            />
          )}
        </CardBody>
      </Card>
    </Container>
  );
}
