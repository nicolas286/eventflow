import { Route, Navigate } from "react-router-dom";

import { PublicShellLayout } from "../layouts/PublicShellLayout";
import { PublicLayout } from "../layouts/PublicLayout";

import { OrgPublicPage } from "@app/modules/public/organization/pages/OrgPublicPage";
import { EventTicketsPage } from "@app/modules/public/register/pages/EventTicketsPage";
import { EventAttendeesPage } from "@app/modules/public/register/pages/EventAttendeesPage/EventAttendeesPage";
import { EventPaymentPage } from "@app/modules/public/register/pages/EventPaymentPage";
import { OrderPage } from "@app/modules/public/register/pages/OrderPage";
import { WidgetOrgPage } from "@app/modules/public/widget/pages/WidgetOrgPage";
import { WidgetTicketsPage } from "@app/modules/public/widget/pages/WidgetTicketsPage";
import { WidgetAttendeesPage } from "@app/modules/public/widget/pages/WidgetAttendeesPage";
import { WidgetPaymentPage } from "@app/modules/public/widget/pages/WidgetPaymentPage";
import WidgetConfirmationPage from "@app/modules/public/widget/pages/WidgetConfirmationPage";
import LegalPage from "@shared/pages/Legal";
import PrivacyPage from "@shared/pages/Privacy";
import TermsPage from "@shared/pages/TermsPage";
import ConnectTermsPage from "@shared/pages/ConnectTermsPage";
import DataProcessingPage from "@shared/pages/DataProcessingPage";
import BuyerTermsPage from "@shared/pages/BuyerTermsPage";

export const PublicRoutes = (
  <>
    <Route element={<PublicShellLayout />}>
      <Route path="/o/:orgSlug" element={<PublicLayout />}>
        <Route index element={<OrgPublicPage />} />
        <Route path="e/:eventSlug" element={<Navigate to="billets" replace />} />
        <Route path="e/:eventSlug/billets" element={<EventTicketsPage />} />
        <Route path="e/:eventSlug/participants" element={<EventAttendeesPage />} />
        <Route path="e/:eventSlug/paiement" element={<EventPaymentPage />} />
      </Route>

      <Route path="/order/:orderId" element={<OrderPage />} />
      <Route path="/mentions-legales" element={<LegalPage />} />
      <Route path="/politique-confidentialite" element={<PrivacyPage />} />
      <Route path="/cgu" element={<TermsPage />} />
      <Route path="/conditions-connect" element={<ConnectTermsPage />} />
      <Route path="/accord-traitement-donnees" element={<DataProcessingPage />} />
      <Route path="/conditions-billetterie" element={<BuyerTermsPage />} />
    </Route>

    <Route path="/widget/o/:orgSlug" element={<WidgetOrgPage />} />
    <Route path="/widget/o/:orgSlug/e/:eventSlug/billets" element={<WidgetTicketsPage />} />
    <Route path="/widget/o/:orgSlug/e/:eventSlug/participants" element={<WidgetAttendeesPage />} />
    <Route path="/widget/o/:orgSlug/e/:eventSlug/paiement" element={<WidgetPaymentPage />} />
    <Route path="/widget/o/:orgSlug/e/:eventSlug/confirmation" element={<WidgetConfirmationPage />}
/>
  </>
);
