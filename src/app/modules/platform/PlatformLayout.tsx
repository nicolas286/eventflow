import type { ReactNode } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { PlatformSecurityProvider } from "./security/PlatformSecurity";
import "./platform.css";

type IconName =
  | "overview"
  | "organizations"
  | "onboarding"
  | "finance"
  | "operations"
  | "communications"
  | "configuration"
  | "audit"
  | "admins";

const groups: Array<{
  label: string;
  links: Array<{ to: string; label: string; icon: IconName }>;
}> = [
  {
    label: "Pilotage",
    links: [
      { to: "/platform", label: "Vue d’ensemble", icon: "overview" },
      {
        to: "/platform/organizations",
        label: "Organisations",
        icon: "organizations",
      },
      { to: "/platform/onboarding", label: "Onboarding", icon: "onboarding" },
      { to: "/platform/finance", label: "Finance", icon: "finance" },
      { to: "/platform/operations", label: "Exploitation", icon: "operations" },
    ],
  },
  {
    label: "Diffusion",
    links: [
      {
        to: "/platform/communications",
        label: "Communications",
        icon: "communications",
      },
      {
        to: "/platform/configuration",
        label: "Configuration",
        icon: "configuration",
      },
    ],
  },
  {
    label: "Sécurité",
    links: [
      { to: "/platform/audit", label: "Journal d’audit", icon: "audit" },
      { to: "/platform/admins", label: "Administrateurs", icon: "admins" },
    ],
  },
];

const iconPaths: Record<IconName, ReactNode> = {
  overview: (
    <>
      <path d="M4 13h6V4H4v9Zm10 7h6V11h-6v9ZM4 20h6v-3H4v3Zm10-13h6V4h-6v3Z" />
    </>
  ),
  organizations: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  onboarding: (
    <>
      <path d="M12 5v14M5 12h14" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  finance: (
    <>
      <path d="M3 6h18v12H3zM3 10h18M7 15h3" />
    </>
  ),
  operations: (
    <>
      <path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.12.37.33.72.6 1 .28.28.63.49 1 .6h.09v4H21c-.39.01-.75.15-1.03.42-.28.26-.48.6-.57.98Z" />
    </>
  ),
  communications: (
    <>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  configuration: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6" />
    </>
  ),
  audit: (
    <>
      <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
      <path d="M9 3h6v4H9zM8 12h8M8 16h5" />
    </>
  ),
  admins: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0M18 3l1 1 2-2" />
    </>
  ),
};

function NavIcon({ name }: { name: IconName }) {
  return (
    <svg
      className="platformNavIcon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  );
}

export function PlatformLayout() {
  const { user, signOut } = useAuth();
  const initial = user?.email?.slice(0, 1).toUpperCase() ?? "A";
  return (
    <PlatformSecurityProvider>
      <Helmet>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <div className="platformRoot">
        <aside className="platformSidebar">
          <div className="platformBrand">
            <span className="platformMark">EF</span>
            <div>
              <strong>Eventflow</strong>
              <small>Platform control</small>
            </div>
          </div>
          <nav aria-label="Navigation plateforme">
            {groups.map((group) => (
              <div className="platformNavGroup" key={group.label}>
                <p>{group.label}</p>
                {group.links.map((link) => (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end={link.to === "/platform"}
                  >
                    <NavIcon name={link.icon} />
                    <span>{link.label}</span>
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <footer>
            <span className="platformUserAvatar">{initial}</span>
            <div>
              <strong>{user?.email}</strong>
              <button type="button" onClick={() => void signOut()}>
                Se déconnecter
              </button>
            </div>
          </footer>
        </aside>
        <main className="platformMain">
          <div className="platformMainInner">
            <Outlet />
          </div>
        </main>
      </div>
    </PlatformSecurityProvider>
  );
}
