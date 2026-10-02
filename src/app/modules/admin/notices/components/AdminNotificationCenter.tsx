import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BellIcon, CloseIcon } from "@ui/components/icon/Icons";
import type { AdminNotificationCenterState } from "../hooks/useAdminNotifications";
import "./AdminNotificationCenter.css";

export type AdminNotificationCenterProps = AdminNotificationCenterState;

export function AdminNotificationCenter({
  notifications,
  unreadCount,
  onDismiss,
  onMarkAllAsRead,
  onMarkAsRead,
}: AdminNotificationCenterProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const triggerLabel =
    unreadCount > 0
      ? `Notifications, ${unreadCount} non lue${unreadCount > 1 ? "s" : ""}`
      : "Notifications";

  return (
    <div ref={rootRef} className="adminNotificationCenter">
      <button
        ref={triggerRef}
        type="button"
        className="adminNotificationCenter__trigger"
        aria-label={triggerLabel}
        title={triggerLabel}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
      >
        <BellIcon />
        {unreadCount > 0 ? (
          <span className="adminNotificationCenter__badge" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <section
          id={panelId}
          className="adminNotificationCenter__panel"
          role="dialog"
          aria-label="Centre de notifications"
        >
          <header className="adminNotificationCenter__header">
            <div>
              <strong>Notifications</strong>
              <span>
                {notifications.length} notification
                {notifications.length > 1 ? "s" : ""}
              </span>
            </div>
            <button
              type="button"
              className="adminNotificationCenter__readAll"
              onClick={onMarkAllAsRead}
              disabled={unreadCount === 0}
            >
              Tout marquer comme lu
            </button>
          </header>

          {notifications.length === 0 ? (
            <div className="adminNotificationCenter__empty">
              <BellIcon />
              <strong>Aucune notification</strong>
              <span>Vous êtes à jour.</span>
            </div>
          ) : (
            <div className="adminNotificationCenter__list">
              {notifications.map((notification) => (
                <article
                  key={notification.id}
                  className={`adminNotificationCenter__item adminNotificationCenter__item--${notification.tone}${notification.isRead ? " isRead" : " isUnread"}`}
                >
                  <div className="adminNotificationCenter__itemCopy">
                    <div className="adminNotificationCenter__itemHeading">
                      {!notification.isRead ? (
                        <span
                          className="adminNotificationCenter__unreadDot"
                          aria-label="Non lue"
                        />
                      ) : null}
                      <strong>{notification.title}</strong>
                    </div>
                    <p>{notification.body}</p>
                    {notification.to && notification.cta ? (
                      <Link
                        to={notification.to}
                        onClick={() => {
                          onMarkAsRead(notification.id);
                          setOpen(false);
                        }}
                      >
                        {notification.cta}
                      </Link>
                    ) : null}
                  </div>

                  {notification.dismissible ? (
                    <button
                      type="button"
                      className="adminNotificationCenter__dismiss"
                      onClick={() => onDismiss(notification.id)}
                      aria-label={`Supprimer la notification « ${notification.title} »`}
                      title="Supprimer la notification"
                    >
                      <CloseIcon />
                    </button>
                  ) : (
                    <span className="adminNotificationCenter__required">
                      Action requise
                    </span>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
