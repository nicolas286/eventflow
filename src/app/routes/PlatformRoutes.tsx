import { Route } from "react-router-dom";
import { PlatformAccessGate } from "@app/modules/platform/auth/PlatformAccessGate";
import { PlatformLoginPage } from "@app/modules/platform/auth/PlatformLoginPage";
import { PlatformMfaPage } from "@app/modules/platform/auth/PlatformMfaPage";
import { PlatformLayout } from "@app/modules/platform/PlatformLayout";
import { PlatformOverviewPage } from "@app/modules/platform/pages/PlatformOverviewPage";
import { PlatformOrganizationsPage } from "@app/modules/platform/pages/PlatformOrganizationsPage";
import { PlatformOrganizationPage } from "@app/modules/platform/pages/PlatformOrganizationPage";
import { PlatformOnboardingPage } from "@app/modules/platform/pages/PlatformOnboardingPage";
import { PlatformFinancePage } from "@app/modules/platform/pages/PlatformFinancePage";
import { PlatformOperationsPage } from "@app/modules/platform/pages/PlatformOperationsPage";
import { PlatformConfigurationPage } from "@app/modules/platform/pages/PlatformConfigurationPage";
import { PlatformAuditPage } from "@app/modules/platform/pages/PlatformAuditPage";
import { PlatformAdminsPage } from "@app/modules/platform/pages/PlatformAdminsPage";

export const PlatformRoutes = <>
  <Route path="/platform/login" element={<PlatformLoginPage />} />
  <Route path="/platform/mfa" element={<PlatformMfaPage />} />
  <Route path="/platform" element={<PlatformAccessGate><PlatformLayout /></PlatformAccessGate>}>
    <Route index element={<PlatformOverviewPage />} />
    <Route path="organizations" element={<PlatformOrganizationsPage />} />
    <Route path="organizations/:organizationId" element={<PlatformOrganizationPage />} />
    <Route path="onboarding" element={<PlatformOnboardingPage />} />
    <Route path="finance" element={<PlatformFinancePage />} />
    <Route path="operations" element={<PlatformOperationsPage />} />
    <Route path="configuration" element={<PlatformConfigurationPage />} />
    <Route path="audit" element={<PlatformAuditPage />} />
    <Route path="admins" element={<PlatformAdminsPage />} />
  </Route>
</>;
