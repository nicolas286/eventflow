import { NavLink, Outlet } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { PlatformSecurityProvider } from "./security/PlatformSecurity";
import "./platform.css";

const links = [
  ["/platform", "Vue d’ensemble"],
  ["/platform/organizations", "Organisations"],
  ["/platform/onboarding", "Onboarding"],
  ["/platform/finance", "Finance"],
  ["/platform/operations", "Exploitation"],
  ["/platform/configuration", "Configuration"],
  ["/platform/audit", "Journal"],
  ["/platform/admins", "Administrateurs"],
] as const;

export function PlatformLayout() {
  const { user, signOut } = useAuth();
  return (
    <PlatformSecurityProvider>
      <Helmet><meta name="robots" content="noindex,nofollow" /></Helmet>
      <div className="platformRoot">
        <aside className="platformSidebar">
          <div><span className="platformMark">EF</span><div><strong>Eventflow</strong><small>Platform control</small></div></div>
          <nav aria-label="Navigation plateforme">
            {links.map(([to, label]) => <NavLink key={to} to={to} end={to === "/platform"}>{label}</NavLink>)}
          </nav>
          <footer><span>{user?.email}</span><button type="button" onClick={() => void signOut()}>Déconnexion</button></footer>
        </aside>
        <main className="platformMain"><Outlet /></main>
      </div>
    </PlatformSecurityProvider>
  );
}
