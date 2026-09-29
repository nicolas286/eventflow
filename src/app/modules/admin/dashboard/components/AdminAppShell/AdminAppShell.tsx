import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";

import { useAuth } from "@providers/AuthProvider/useAuth";
import { useToast } from "@ui/components/toast/useToast";
import type { OrgInfo } from "@ui/components/navigation/TopNav";
import {
  CalendarIcon,
  CloseIcon,
  CoinsIcon,
  EyeIcon,
  GlobeIcon,
  GridIcon,
  LogoutIcon,
  UserIcon,
} from "@ui/components/icon/Icons";

import "./AdminAppShell.css";

type AdminAppShellProps = {
  children: ReactNode;
  org: OrgInfo | null;
  userName?: string | null;
};

type NavigationItem = {
  label: string;
  path: string;
  icon: ReactNode;
};

const managementItems: NavigationItem[] = [
  {
    label: "Événements",
    path: "/admin/events",
    icon: <CalendarIcon />,
  },
  {
    label: "Billetterie sur mon site",
    path: "/admin/widget",
    icon: <GridIcon />,
  },
];

const organizationItems: NavigationItem[] = [
  {
    label: "Apparence",
    path: "/admin/branding",
    icon: <EyeIcon />,
  },
  {
    label: "Profil organisateur",
    path: "/admin/structure",
    icon: <GlobeIcon />,
  },
  {
    label: "Abonnement",
    path: "/admin/abonnement",
    icon: <CoinsIcon />,
  },
  {
    label: "Profil personnel",
    path: "/admin/profil",
    icon: <UserIcon />,
  },
];

const allItems = [...managementItems, ...organizationItems];

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getPublicPath(org: OrgInfo | null) {
  const slug = org?.slug?.trim() || (org?.name ? slugify(org.name) : "");
  return slug ? `/o/${slug}` : null;
}

function getInitials(value?: string | null) {
  const initials = value
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return initials || "EF";
}

function NavigationGroup({
  label,
  items,
  onNavigate,
}: {
  label: string;
  items: NavigationItem[];
  onNavigate: () => void;
}) {
  return (
    <div className="adminSidebar__group">
      <div className="adminSidebar__groupLabel">{label}</div>
      <nav className="adminSidebar__nav" aria-label={label}>
        {items.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              `adminSidebar__navLink${isActive ? " isActive" : ""}`
            }
            onClick={onNavigate}
          >
            <span className="adminSidebar__navIcon" aria-hidden="true">
              {item.icon}
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function AdminAppShell({ children, org, userName }: AdminAppShellProps) {
  const location = useLocation();
  const { signOut } = useAuth();
  const { showToast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const publicPath = getPublicPath(org);
  const activeLabel = useMemo(() => {
    if (location.pathname.startsWith("/admin/events/")) return "Événement";

    return (
      allItems.find((item) => location.pathname.startsWith(item.path))?.label ??
      "Administration"
    );
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMobileOpen(false);
    }

    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileOpen]);

  async function copyPublicLink() {
    if (!publicPath) return;

    const publicUrl = `${window.location.origin}${publicPath}`;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(publicUrl);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = publicUrl;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) throw new Error("COPY_FAILED");
      }

      showToast({
        title: "Lien copié",
        description:
          "L’adresse de votre page publique est dans le presse-papier.",
        variant: "success",
        duration: 3500,
      });
    } catch {
      showToast({
        title: "Copie impossible",
        description: "Ouvrez la page publique pour copier son adresse.",
        variant: "error",
        duration: 5000,
      });
    }
  }

  async function handleLogout() {
    if (loggingOut) return;

    setLoggingOut(true);
    try {
      await signOut();
    } catch {
      setLoggingOut(false);
      showToast({
        title: "Déconnexion impossible",
        description: "Réessayez dans quelques instants.",
        variant: "error",
        duration: 5000,
      });
    }
  }

  const sidebar = (
    <aside className="adminSidebar" aria-label="Navigation de l’administration">
      <div className="adminSidebar__mobileHeader">
        <span>Menu</span>
        <button
          type="button"
          className="adminSidebar__iconButton"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
        >
          <CloseIcon />
        </button>
      </div>

      <div className="adminSidebar__brand">
        {org?.logoUrl ? (
          <img className="adminSidebar__logo" src={org.logoUrl} alt="" />
        ) : (
          <span className="adminSidebar__logoFallback" aria-hidden="true">
            {getInitials(org?.name).slice(0, 1)}
          </span>
        )}
        <div className="adminSidebar__brandCopy">
          <strong>{org?.name ?? "Eventflow"}</strong>
          <span>Espace organisateur</span>
        </div>
      </div>

      <div className="adminSidebar__body">
        <NavigationGroup
          label="Gestion"
          items={managementItems}
          onNavigate={() => setMobileOpen(false)}
        />
        <NavigationGroup
          label="Organisation"
          items={organizationItems}
          onNavigate={() => setMobileOpen(false)}
        />

        {publicPath ? (
          <div className="adminSidebar__publicCard">
            <div>
              <strong>Votre page publique</strong>
              <span>Consultez-la comme un participant.</span>
            </div>
            <div className="adminSidebar__publicActions">
              <a href={publicPath} target="_blank" rel="noreferrer">
                Ouvrir
              </a>
              <button type="button" onClick={() => void copyPublicLink()}>
                Copier le lien
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="adminSidebar__footer">
        <div className="adminSidebar__avatar" aria-hidden="true">
          {getInitials(userName)}
        </div>
        <div className="adminSidebar__userCopy">
          <strong>{userName || "Mon compte"}</strong>
          <span>Administrateur</span>
        </div>
        <button
          type="button"
          className="adminSidebar__logout"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          aria-label={loggingOut ? "Déconnexion en cours" : "Se déconnecter"}
          title={loggingOut ? "Déconnexion en cours" : "Se déconnecter"}
        >
          <LogoutIcon />
        </button>
      </div>
    </aside>
  );

  return (
    <div className="adminAppShell">
      <div className="adminAppShell__desktopSidebar">{sidebar}</div>

      <div
        className={`adminAppShell__mobileLayer${mobileOpen ? " isOpen" : ""}`}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          className="adminAppShell__backdrop"
          onClick={() => setMobileOpen(false)}
          aria-label="Fermer le menu"
          tabIndex={mobileOpen ? 0 : -1}
        />
        <div className="adminAppShell__mobileSidebar">{sidebar}</div>
      </div>

      <main className="adminAppShell__main">
        <header className="adminAppShell__topbar">
          <div className="adminAppShell__topbarLeft">
            <button
              type="button"
              className="adminAppShell__menuButton"
              onClick={() => setMobileOpen(true)}
              aria-label="Ouvrir le menu"
              aria-expanded={mobileOpen}
            >
              <span />
              <span />
              <span />
            </button>
            <div>
              <span className="adminAppShell__eyebrow">
                Espace organisateur
              </span>
              <strong>{activeLabel}</strong>
            </div>
          </div>

          {publicPath ? (
            <a
              className="adminAppShell__publicLink"
              href={publicPath}
              target="_blank"
              rel="noreferrer"
            >
              <EyeIcon />
              <span>Voir la page publique</span>
            </a>
          ) : null}
        </header>

        <div className="adminAppShell__content">{children}</div>
      </main>
    </div>
  );
}
