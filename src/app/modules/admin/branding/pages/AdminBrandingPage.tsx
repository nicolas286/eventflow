import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";

import { Container } from "../../../../../shared/ui/components";
import Card, {
  CardBody,
  CardHeader,
} from "../../../../../shared/ui/components/card/Card";

import BrandingPanel from "../components/BrandingPanel";
import type { AdminOutletContext } from "../../dashboard/components/AdminDashboard";
import { type OrgBrandingUI } from "../schemas/admin.orgBranding.schema";
import { AdminPageHeader } from "../../dashboard/components/AdminPageHeader/AdminPageHeader";

export default function AdminBrandingPage() {
  const { bootstrap, orgId, refetch } = useOutletContext<AdminOutletContext>();
  const orgProfile = bootstrap?.organizationProfile;
  const orgPlan = bootstrap?.organization?.plan;

  const initial = useMemo<OrgBrandingUI>(
    () => ({
      displayName: orgProfile?.displayName ?? "Mon organisation",
      primaryColor: orgProfile?.primaryColor ?? "#2563eb",
      logoUrl: orgProfile?.logoUrl ?? "",
      defaultEventBannerUrl: orgProfile?.defaultEventBannerUrl ?? "",
    }),
    [orgProfile],
  );

  const [branding, setBranding] = useState<OrgBrandingUI>(initial);

  useEffect(() => {
    setBranding(initial);
  }, [initial]);

  return (
    <Container>
      <AdminPageHeader
        eyebrow="Identité de marque"
        title="Apparence"
        description="Définissez une identité reconnaissable tout en conservant une interface lisible et cohérente sur vos pages publiques."
      />
      <Card>
        <CardHeader
          title="Personnalisation"
          subtitle="Couleur principale, logo et bannière par défaut de votre organisation."
        />
        <CardBody>
          <BrandingPanel
            orgId={orgId}
            org={branding}
            setOrg={setBranding}
            onSaved={refetch}
            orgPlan={orgPlan}
          />
        </CardBody>
      </Card>
    </Container>
  );
}
