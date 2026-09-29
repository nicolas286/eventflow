import { useMemo, useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";

import { Container } from "@shared/ui/components";
import Card, { CardBody, CardHeader } from "@shared/ui/components/card/Card";

import type { AdminOutletContext } from "../../dashboard/components/AdminDashboard";
import WidgetPanel from "../components/WidgetPanel";
import { AdminPageHeader } from "../../dashboard/components/AdminPageHeader/AdminPageHeader";

export type WidgetThemeUI = {
  widgetBg?: string | null;
  widgetCard?: string | null;
  widgetText?: string | null;
  widgetButton?: string | null;
  slug?: string | null;
};

export default function AdminWidgetPage() {
  const { bootstrap } = useOutletContext<AdminOutletContext>();

  const orgProfile = bootstrap?.organizationProfile;
  const orgPlan = bootstrap?.organization?.plan;

  const initial = useMemo<WidgetThemeUI>(
    () => ({
      slug: orgProfile?.slug ?? "",
      widgetBg: orgProfile?.widgetBg ?? "#612510",
      widgetCard: orgProfile?.widgetCard ?? "#612510",
      widgetText: orgProfile?.widgetText ?? "#FFDE59",
      widgetButton: orgProfile?.widgetButton ?? "#D9931A",
    }),
    [orgProfile],
  );

  const [widgetTheme, setWidgetTheme] = useState<WidgetThemeUI>(initial);

  useEffect(() => {
    setWidgetTheme(initial);
  }, [initial]);

  return (
    <Container>
      <AdminPageHeader
        eyebrow="Intégration"
        title="Billetterie sur votre site"
        description="Personnalisez le widget, vérifiez son rendu et récupérez le code prêt à intégrer sur votre propre site."
      />
      <Card>
        <CardHeader
          title="Configuration du widget"
          subtitle="Les couleurs restent sous votre contrôle et l’aperçu se met à jour automatiquement."
        />
        <CardBody>
          <WidgetPanel
            org={widgetTheme}
            setOrg={setWidgetTheme}
            orgPlan={orgPlan}
          />
        </CardBody>
      </Card>
    </Container>
  );
}
