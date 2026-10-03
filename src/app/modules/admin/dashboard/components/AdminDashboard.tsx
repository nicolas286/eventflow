import {
  Outlet,
  useLocation,
  Navigate,
  useOutletContext,
} from "react-router-dom";
import "./AdminDashBoard.desktop.css";
import "./AdminDashBoard.mobile.css";

import { Button } from "@shared/ui/components";
import type { OrgInfo } from "@shared/ui/components/navigation/TopNav";
import { supabase } from "@gateways/supabase/supabaseClient";
import { useAdminDashboardData } from "../hooks/useAdminDashboardData";

import OrgThemeSync from "@shared/ui/components/theme/OrgThemeSync";

import type { EventOverviewRow } from "../../events/schemas/admin.eventsOverview.schema";
import type { DashboardBootstrap } from "../schemas/admin.dashboardBootstrap.schema";
import { normalizeError } from "@shared/errors/errors";
import { AdminAppShell } from "./AdminAppShell/AdminAppShell";
import { useAdminNotifications } from "../../notices/hooks/useAdminNotifications";
import type { AdminLayoutOutletContext } from "@app/layouts/AdminLayout";

export type AdminOutletContext = {
  org: OrgInfo | null;
  orgId: string; // on garde string, mais on passera "" pour onboarding
  bootstrap: DashboardBootstrap;
  events: EventOverviewRow[];
  refetch: () => Promise<void>;
};

export default function AdminDashboard() {
  const location = useLocation();
  const { colorScheme, toggleColorScheme } =
    useOutletContext<AdminLayoutOutletContext>();
  const isOnboarding = location.pathname.startsWith("/admin/onboarding");

  const { loading, error, bootstrap, orgId, events, refetch } =
    useAdminDashboardData({ supabase });
  const notificationCenter = useAdminNotifications(bootstrap);

  const topNavOrg: OrgInfo | null = bootstrap
    ? {
        name:
          bootstrap.organizationProfile?.displayName ??
          bootstrap.organization?.name,
        logoUrl: bootstrap.organizationProfile?.logoUrl ?? undefined,
        slug: bootstrap.organizationProfile?.slug ?? undefined,
      }
    : null;

  const primaryHex = bootstrap?.organizationProfile?.primaryColor ?? "#2563eb";
  const userName = bootstrap?.profile
    ? [bootstrap.profile.firstName, bootstrap.profile.lastName]
        .filter(Boolean)
        .join(" ")
    : null;
  const userRole = bootstrap?.membership?.[0]?.role ?? null;

  if (loading && !bootstrap) {
    const loadingContent = (
      <div className="adminPageRight">
        <div className="adminWorkspaceState" aria-live="polite">
          <span className="adminWorkspaceState__spinner" aria-hidden="true" />
          <strong>Préparation de votre espace</strong>
          <span>Nous chargeons vos événements et vos réglages.</span>
        </div>
      </div>
    );

    return (
      <div className="adminPage">
        <OrgThemeSync primaryColor={primaryHex} />
        {isOnboarding ? (
          loadingContent
        ) : (
          <AdminAppShell
            org={topNavOrg}
            colorScheme={colorScheme}
            onToggleColorScheme={toggleColorScheme}
            notificationCenter={notificationCenter}
          >
            {loadingContent}
          </AdminAppShell>
        )}
      </div>
    );
  }

  if (error) {
    const appError = normalizeError(
      error,
      "Une erreur est survenue. Réessayez dans quelques instants.",
    );

    const errorContent = (
      <div className="adminPageRight">
        <div
          className="adminWorkspaceState adminWorkspaceState--error"
          role="alert"
        >
          <strong>Impossible de charger l’espace organisateur</strong>
          <span>{appError.message}</span>
          <Button variant="secondary" onClick={() => void refetch()}>
            Réessayer
          </Button>
        </div>
      </div>
    );

    return (
      <div className="adminPage">
        <OrgThemeSync primaryColor={primaryHex} />
        {isOnboarding ? (
          errorContent
        ) : (
          <AdminAppShell
            org={topNavOrg}
            userName={userName}
            userRole={userRole}
            colorScheme={colorScheme}
            onToggleColorScheme={toggleColorScheme}
            notificationCenter={notificationCenter}
          >
            {errorContent}
          </AdminAppShell>
        )}
      </div>
    );
  }

  // ✅ bootstrap devrait exister ici (sinon on garde un fallback safe)
  if (!bootstrap) {
    const fallbackContent = (
      <div className="adminPageRight">
        <div className="adminWorkspaceState" aria-live="polite">
          <span className="adminWorkspaceState__spinner" aria-hidden="true" />
          <strong>Chargement en cours</strong>
        </div>
      </div>
    );

    return (
      <div className="adminPage">
        <OrgThemeSync primaryColor={primaryHex} />
        {isOnboarding ? (
          fallbackContent
        ) : (
          <AdminAppShell
            org={topNavOrg}
            colorScheme={colorScheme}
            onToggleColorScheme={toggleColorScheme}
            notificationCenter={notificationCenter}
          >
            {fallbackContent}
          </AdminAppShell>
        )}
      </div>
    );
  }

  // ✅ Pas d'orga => on autorise uniquement /admin/onboarding à s'afficher
  if (!orgId && !isOnboarding) {
    return <Navigate to="/admin/onboarding" replace />;
  }

  const content = (
    <div className="adminPageRight">
      <Outlet
        key={orgId ?? "onboarding"}
        context={
          {
            org: topNavOrg,
            orgId: orgId ?? "", // ✅ onboarding: "" (pas utilisé)
            bootstrap,
            events,
            refetch,
          } satisfies AdminOutletContext
        }
      />
    </div>
  );

  return (
    <div className="adminPage">
      <OrgThemeSync primaryColor={primaryHex} />
      {isOnboarding ? (
        content
      ) : (
        <AdminAppShell
          org={topNavOrg}
          userName={userName}
          userRole={userRole}
          colorScheme={colorScheme}
          onToggleColorScheme={toggleColorScheme}
          notificationCenter={notificationCenter}
        >
          {content}
        </AdminAppShell>
      )}
    </div>
  );
}
