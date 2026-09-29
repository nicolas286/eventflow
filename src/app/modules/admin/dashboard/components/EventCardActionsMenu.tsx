import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import { Button } from "@ui/components";

import "./EventCardActionsMenu.css";

import {
  CopyIcon,
  NotepadIcon,
  FacebookIcon,
  EditIcon,
  CloseIcon,
  TrashIcon,
  WhatsappIcon,
  DotsIcon,
} from "@ui/components/icon/Icons";

type MenuItem =
  | { kind: "separator"; key: string }
  | {
      kind: "link";
      key: string;
      label: string;
      icon: React.ReactNode;
      to: string;
      disabled?: boolean;
    }
  | {
      kind: "action";
      key: string;
      label: string;
      icon: React.ReactNode;
      tone?: "default" | "danger";
      onClick: () => void | Promise<void>;
      disabled?: boolean;
    };

type Props = {
  canView: boolean;
  detailsTo?: string;

  isSelected: boolean;

  onToggleInlineEdit: () => void;
  onCopyLink?: () => void | Promise<void>;
  onDuplicate: () => void | Promise<void>;
  onShareFacebook?: () => void;
  onShareWhatsapp?: () => void;
  onDelete: () => void;

  buttonLabel?: string;
};

export default function EventCardActionsMenu({
  canView,
  detailsTo,
  isSelected,
  onToggleInlineEdit,
  onCopyLink,
  onDuplicate,
  onShareFacebook,
  onShareWhatsapp,
  onDelete,
  buttonLabel = "Actions",
}: Props) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const items: MenuItem[] = useMemo(() => {
    const base: MenuItem[] = [];

    /* --------- 📄 Consultation --------- */
    if (canView && detailsTo) {
      base.push({
        kind: "link",
        key: "details",
        label: "Voir les détails",
        icon: <NotepadIcon />,
        to: detailsTo,
      });
    }

    /* --------- ✏️ Gestion --------- */
    base.push({
      kind: "action",
      key: "toggleEdit",
      label: isSelected ? "Fermer l’éditeur rapide" : "Modifier rapidement",
      icon: isSelected ? <CloseIcon /> : <EditIcon />,
      onClick: onToggleInlineEdit,
    });

    base.push({
      kind: "action",
      key: "duplicate",
      label: "Dupliquer l’événement",
      icon: <CopyIcon />,
      onClick: onDuplicate,
    });

    /* --------- 🔗 Partage --------- */
    const hasShare =
      canView && (onShareFacebook || onShareWhatsapp || onCopyLink);

    if (hasShare) {
      if (base.length) {
        base.push({ kind: "separator", key: "sep_before_share" });
      }

      if (onShareFacebook) {
        base.push({
          kind: "action",
          key: "shareFb",
          label: "Partager sur Facebook",
          icon: <FacebookIcon />,
          onClick: onShareFacebook,
        });
      }

      if (onShareWhatsapp) {
        base.push({
          kind: "action",
          key: "shareWa",
          label: "Partager sur WhatsApp",
          icon: <WhatsappIcon />,
          onClick: onShareWhatsapp,
        });
      }

      if (onCopyLink) {
        base.push({
          kind: "action",
          key: "copyLink",
          label: "Copier le lien public",
          icon: <CopyIcon />,
          onClick: onCopyLink,
        });
      }
    }

    if (base.length) {
      base.push({ kind: "separator", key: "sep_before_delete" });
    }

    base.push({
      kind: "action",
      key: "delete",
      label: "Supprimer",
      icon: <TrashIcon />,
      tone: "danger",
      onClick: onDelete,
    });

    const cleaned: MenuItem[] = [];

    for (const it of base) {
      if (it.kind === "separator") {
        if (cleaned.length === 0) continue;
        if (cleaned[cleaned.length - 1].kind === "separator") continue;
      }
      cleaned.push(it);
    }

    if (cleaned.length && cleaned[cleaned.length - 1].kind === "separator") {
      cleaned.pop();
    }

    return cleaned;
  }, [
    canView,
    detailsTo,
    isSelected,
    onToggleInlineEdit,
    onDuplicate,
    onShareFacebook,
    onShareWhatsapp,
    onCopyLink,
    onDelete,
  ]);

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!open) return;
      const target = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    }

    function onDocKeyDown(e: KeyboardEvent) {
      if (!open) return;
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onDocKeyDown);

    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onDocKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;

    function updatePlacement() {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (!root || !menu) return;

      const rootRect = root.getBoundingClientRect();
      const menuHeight = menu.getBoundingClientRect().height;
      const roomBelow = window.innerHeight - rootRect.bottom;
      const roomAbove = rootRect.top;
      const safetyMargin = 16;
      const shouldOpenUpward =
        roomBelow < menuHeight + safetyMargin && roomAbove > roomBelow;

      menu.classList.toggle("eventCardActions__menu--up", shouldOpenUpward);
      menu.style.maxHeight = `${Math.max(
        48,
        (shouldOpenUpward ? roomAbove : roomBelow) - safetyMargin,
      )}px`;
    }

    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);

    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open]);

  return (
    <div className="eventCardActions" ref={rootRef}>
      <Button
        variant="secondary"
        className="eventCardActions__trigger"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title="Ouvrir les actions"
      >
        <DotsIcon />
        {buttonLabel}
      </Button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="eventCardActions__menu"
          role="menu"
          aria-label="Actions de l'événement"
          onClick={(e) => e.stopPropagation()}
        >
          {items.map((it) => {
            if (it.kind === "separator") {
              return (
                <div
                  key={it.key}
                  className="eventCardActions__separator"
                  role="separator"
                  aria-hidden="true"
                />
              );
            }

            const toneClass =
              it.kind === "action" && it.tone === "danger" ? "isDanger" : "";

            if (it.kind === "link") {
              return (
                <Link
                  key={it.key}
                  to={it.to}
                  className={`eventCardActions__item ${toneClass} ${it.disabled ? "isDisabled" : ""}`}
                  role="menuitem"
                  aria-disabled={it.disabled ? true : undefined}
                  tabIndex={0}
                  onClick={() => setOpen(false)}
                >
                  <span className="eventCardActions__icon">{it.icon}</span>
                  <span className="eventCardActions__label">{it.label}</span>
                </Link>
              );
            }

            return (
              <button
                key={it.key}
                type="button"
                className={`eventCardActions__item ${toneClass} ${it.disabled ? "isDisabled" : ""}`}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  const r = it.onClick();
                  setOpen(false);
                  void r;
                }}
              >
                <span className="eventCardActions__icon">{it.icon}</span>
                <span className="eventCardActions__label">{it.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
