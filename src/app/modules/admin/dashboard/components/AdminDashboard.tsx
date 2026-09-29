import { Outlet, useLocation, Navigate } from "react-router-dom";
import "./AdminDashBoard.desktop.css";
import "./AdminDashBoard.mobile.css";

import { TopNav } from "@shared/ui/components";
import type { OrgInfo } from "@shared/ui/components/navigation/TopNav";
import { supabase } from "@gateways/supabase/supabaseClient";
import { useAdminDashboardData } from "../hooks/useAdminDashboardData";

import OrgThemeSync from "@shared/ui/components/theme/OrgThemeSync";

import type { EventOverviewRow } from "../../events/schemas/admin.eventsOverview.schema";
import type { DashboardBootstrap } from "../schemas/admin.dashboardBootstrap.schema";
import { normalizeError } from "@shared/errors/errors";
import { StripeMigrationNotice } from "../../notices/components/StripeMigrationNotice";
import { AdminAppShell } from "./AdminAppShell/AdminAppShell";

export type AdminOutletContext = {
  org: OrgInfo | null;
  orgId: string; // on garde string, mais on passera "" pour onboarding
  bootstrap: DashboardBootstrap;
  events: EventOverviewRow[];
  refetch: () => Promise<void>;
};

export default function AdminDashboard() {
  const location = useLocation();
  const isOnboarding = location.pathname.startsWith("/admin/onboarding");

  const { loading, error, bootstrap, orgId, events, refetch } =
    useAdminDashboardData({ supabase });

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
    return (
      <div className="adminPage">
        <OrgThemeSync primaryColor={primaryHex} />
        <TopNav mode="admin" org={topNavOrg} />
        <div className="adminPageGrid">
          <div className="adminPageRight">Chargement…</div>
        </div>
      </div>
    );
  }

  if (error) {
    const appError = normalizeError(
      error,
      "Une erreur est survenue. Réessayez dans quelques instants.",
    );

    return (
      <div className="adminPage">
        <OrgThemeSync primaryColor={primaryHex} />
        {!isOnboarding && <TopNav mode="admin" org={topNavOrg} />}

        <div className="adminPageGrid">
          <div className="adminPageRight">{appError.message}</div>
        </div>
      </div>
    );
  }

  // ✅ bootstrap devrait exister ici (sinon on garde un fallback safe)
  if (!bootstrap) {
    return (
      <div className="adminPage">
        <OrgThemeSync primaryColor={primaryHex} />
        {!isOnboarding && <TopNav mode="admin" org={topNavOrg} />}

        <div className="adminPageGrid">
          <div className="adminPageRight">Chargement…</div>
        </div>
      </div>
    );
  }

  // ✅ Pas d'orga => on autorise uniquement /admin/onboarding à s'afficher
  if (!orgId && !isOnboarding) {
    return <Navigate to="/admin/onboarding" replace />;
  }

  const content = (
    <div className="adminPageRight">
      {!isOnboarding && bootstrap.organization ? (
        <StripeMigrationNotice bootstrap={bootstrap} />
      ) : null}
      <Outlet
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
        <AdminAppShell org={topNavOrg} userName={userName} userRole={userRole}>
          {content}
        </AdminAppShell>
      )}
    </div>
  );
}
