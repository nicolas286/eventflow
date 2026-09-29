import { Route } from "react-router-dom";

import AdminAbonnementPage from "@app/modules/admin/subscriptions/pages/AdminSubscriptionPage";
import AdminBrandingPage from "@app/modules/admin/branding/pages/AdminBrandingPage";
import AdminDashboard from "@app/modules/admin/dashboard/components/AdminDashboard";
import AdminEventsPage from "@app/modules/admin/events/pages/AdminEventsPage";
import { AdminForgotPasswordPage } from "@app/modules/admin/auth/pages/AdminForgotPasswordPage";
import { AdminLoginPage } from "@app/modules/admin/auth/pages/AdminLoginPage";
import AdminProfilPage from "@app/modules/admin/profile/pages/AdminProfilPage";
import { AdminResetPasswordPage } from "@app/modules/admin/auth/pages/AdminResetPasswordPage";
import { AdminSignUpPage } from "@app/modules/admin/auth/pages/AdminSignUpPage";
import AdminStructurePage from "@app/modules/admin/organization/pages/AdminOrganizationPage";
import OnboardingWizard from "@app/modules/admin/onboarding/components/OnboardingWizard";
import { AdminSingleEventPage } from "@app/modules/admin/singleEvent/pages/AdminSingleEventPage";

import { AdminAuthLayout } from "../layouts/AdminAuthLayout";
import { AdminLayout } from "../layouts/AdminLayout";
import AdminWidgetPage from "@app/modules/admin/widget/pages/AdminWidgetPage";
import { AdminOverviewPage } from "@app/modules/admin/dashboard/pages/AdminOverviewPage";

export const AdminRoutes = (
  <>
    {/* ADMIN – AUTH */}
    <Route element={<AdminAuthLayout />}>
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin/signup" element={<AdminSignUpPage />} />
      <Route
        path="/admin/forgot-password"
        element={<AdminForgotPasswordPage />}
      />
      <Route
        path="/admin/reset-password"
        element={<AdminResetPasswordPage />}
      />
    </Route>

    {/* ADMIN – PROTÉGÉ */}
    <Route path="/admin" element={<AdminLayout />}>
      <Route element={<AdminDashboard />}>
        <Route index element={<AdminOverviewPage />} />
        <Route path="events" element={<AdminEventsPage />} />
        <Route path="events/:eventSlug" element={<AdminSingleEventPage />} />
        <Route path="widget" element={<AdminWidgetPage />} />
        <Route path="branding" element={<AdminBrandingPage />} />
        <Route path="structure" element={<AdminStructurePage />} />
        <Route path="profil" element={<AdminProfilPage />} />
        <Route path="abonnement" element={<AdminAbonnementPage />} />
        <Route path="onboarding" element={<OnboardingWizard />} />
      </Route>
    </Route>
  </>
);
