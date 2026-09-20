import type { ReactNode } from "react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./topNav.desktop.css";
import "./topNav.mobile.css";

import HamburgerMenu, { MenuDivider, MenuHeader, MenuItem } from "../menus/HamburgerMenu";
import { authRepo } from "@app/modules/admin/auth/data/authRepo";
import { useToast } from "../toast/useToast"; // ✅ add

export type OrgInfo = {
  name?: string;
  logoUrl?: string;
  slug?: string;
};

export type TopNavMode = "public" | "admin";
export type AdminNavKey = "event" | "branding" | "widget" | "structure" | "profil" | "abonnement";

export type TopNavProps = {
  org?: OrgInfo | null;
  mode: TopNavMode;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
};

const adminKeyToPath: Record<AdminNavKey, string> = {
  event: "/admin/events",
  branding: "/admin/branding",
  structure: "/admin/structure",
  profil: "/admin/profil",
  abonnement: "/admin/abonnement",
  widget: "/admin/widget"
};

function slugify(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function getPublicPath(org?: OrgInfo | null) {
  if (!org) return "/";

  if (org.slug && org.slug.trim()) {
    return `/o/${org.slug.trim()}`;
  }

  const name = org.name?.trim();
  if (!name) return "/";

  return `/o/${slugify(name)}`;
}

export default function TopNav({ org, mode }: TopNavProps) {
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);
  const { showToast } = useToast(); // ✅ add

  const title = org?.name ?? "Billetterie";
  const subtitle: ReactNode = mode === "public" ? "Espace public" : "Espace admin";

  const go = (key: AdminNavKey, close: () => void) => {
    if (loggingOut) return;
    navigate(adminKeyToPath[key]);
    close();
  };


  const openPublicInNewTab = (close?: () => void) => {
    if (loggingOut) return;

    const path = getPublicPath(org);
    const fullUrl = `${window.location.origin}${path}`;

    window.open(fullUrl, "_blank", "noopener,noreferrer");
    close?.();
  };

  async function copyPublicUrl(close?: () => void) {
    if (!org) return;

    const path = getPublicPath(org);
    const fullUrl = `${window.location.origin}${path}`;

    try {
      // ✅ clipboard API (https only + perms)
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullUrl);
      } else {
        // fallback rare (vieux navigateurs / context)
        const ta = document.createElement("textarea");
        ta.value = fullUrl;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) throw new Error("COPY_FAILED");
      }

      showToast({
        title: "Copié",
        description: "Adresse du profil public copiée dans le presse-papier.",
        variant: "success",
        duration: 3500,
      });
    } catch (err) {
      console.error("Erreur copie presse-papier", err);
      showToast({
        title: "Impossible de copier",
        description: "Votre navigateur a bloqué l’accès au presse-papier. Copiez manuellement l’URL.",
        variant: "error",
        duration: 6000,
      });
    }

    close?.();
  }

  async function handleLogout(close: () => void) {
    if (loggingOut) return;

    setLoggingOut(true);
    close();

    try {
      await authRepo.signOut();
    } catch {
      showToast({
        title: "Déconnexion impossible",
        description: "Réessayez de vous déconnecter.",
        variant: "error",
        duration: 6000,
      });
    } finally {
      setLoggingOut(false);
    }
  }

    const onLogoClick = () => {
    openPublicInNewTab();
  };

  return (
    <header className="topNav">
      <div className="topNav__inner">
        <div
          className="topNav__left"
          role="button"
          tabIndex={0}
          onClick={onLogoClick}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onLogoClick();
          }}
          style={{ cursor: "pointer" }}
          aria-label="Aller à la page publique"
          title="Voir la page publique"
        >
          {org?.logoUrl ? (
            <img className="topNav__logo" src={org.logoUrl} alt="Logo" />
          ) : (
            <div className="topNav__logoFallback">{(title?.[0] || "A").toUpperCase()}</div>
          )}

          <div className="topNav__titles">
            <div className="topNav__title">{title}</div>
            <div className="topNav__subtitle">{subtitle}</div>
          </div>
        </div>

        <HamburgerMenu>
          {(close) => (
            <>
              <MenuHeader>Menu</MenuHeader>

              {mode === "admin" ? (
                <>
                  <MenuItem label="Voir le profil public" onClick={() => openPublicInNewTab(close)} />
                  <MenuItem label="Copier l’adresse du profil public" onClick={() => copyPublicUrl(close)} />

                  <MenuDivider />

                  <MenuItem label="Mes événements" onClick={() => go("event", close)} />
                  <MenuItem label="Billetterie sur mon site" onClick={() => go("widget", close)} />
                  <MenuItem label="Apparence" onClick={() => go("branding", close)} />
                  <MenuItem label="Profil d'organisateur" onClick={() => go("structure", close)} />
                  <MenuItem label="Profil personnel" onClick={() => go("profil", close)} />
                  <MenuItem label="Mon abonnement" onClick={() => go("abonnement", close)} />

                  <MenuDivider />
                  <MenuItem
                    label={loggingOut ? "Déconnexion…" : "Se déconnecter"}
                    onClick={() => void handleLogout(close)}
                  />
                </>
              ) : null}
            </>
          )}
        </HamburgerMenu>
      </div>
    </header>
  );
}
