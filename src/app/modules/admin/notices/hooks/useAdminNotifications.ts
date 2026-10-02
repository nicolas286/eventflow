import { useEffect, useMemo, useState } from "react";
import { getPlatformPublicConfig } from "@app/modules/platform/data/platformAdminRepo";
import type { PlatformPublicConfig } from "@contracts/platform-admin";
import type { DashboardBootstrap } from "../../dashboard/schemas/admin.dashboardBootstrap.schema";
import {
  getDashboardNotifications,
  getPlatformNotifications,
  type AdminNotificationView,
} from "../adminNotifications";

const STORAGE_PREFIX = "eventflow:admin-notifications:";

type NotificationPreferences = {
  readIds: string[];
  dismissedIds: string[];
};

type ScopedPreferences = NotificationPreferences & {
  scope: string | null;
};

const EMPTY_PREFERENCES: NotificationPreferences = {
  readIds: [],
  dismissedIds: [],
};

function readPreferences(scope: string): NotificationPreferences {
  if (typeof window === "undefined") return EMPTY_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${scope}`);
    if (!raw) return EMPTY_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return EMPTY_PREFERENCES;

    const storedReadIds = Reflect.get(parsed, "readIds");
    const storedDismissedIds = Reflect.get(parsed, "dismissedIds");
    return {
      readIds: Array.isArray(storedReadIds)
        ? storedReadIds.filter((id): id is string => typeof id === "string")
        : [],
      dismissedIds: Array.isArray(storedDismissedIds)
        ? storedDismissedIds.filter(
            (id): id is string => typeof id === "string",
          )
        : [],
    };
  } catch {
    return EMPTY_PREFERENCES;
  }
}

function writePreferences(scope: string, preferences: NotificationPreferences) {
  try {
    window.localStorage.setItem(
      `${STORAGE_PREFIX}${scope}`,
      JSON.stringify(preferences),
    );
  } catch {
    // The notification center remains usable when storage is unavailable.
  }
}

export type AdminNotificationCenterState = {
  notifications: AdminNotificationView[];
  unreadCount: number;
  onDismiss: (id: string) => void;
  onMarkAllAsRead: () => void;
  onMarkAsRead: (id: string) => void;
};

export function useAdminNotifications(
  bootstrap: DashboardBootstrap | null,
): AdminNotificationCenterState {
  const [platformConfig, setPlatformConfig] =
    useState<PlatformPublicConfig | null>(null);
  const [storedPreferences, setStoredPreferences] = useState<ScopedPreferences>(
    {
      scope: null,
      ...EMPTY_PREFERENCES,
    },
  );

  const scope = bootstrap
    ? `${bootstrap.profile.userId}:${bootstrap.organization?.id ?? "no-organization"}`
    : null;

  useEffect(() => {
    let active = true;
    void getPlatformPublicConfig("organizer")
      .then((config) => {
        if (active) setPlatformConfig(config);
      })
      .catch(() => {
        // Operational notices remain available even if the platform feed fails.
      });
    return () => {
      active = false;
    };
  }, []);

  const allNotifications = useMemo(
    () =>
      bootstrap
        ? [
            ...getPlatformNotifications(platformConfig),
            ...getDashboardNotifications(bootstrap),
          ]
        : [],
    [bootstrap, platformConfig],
  );

  const persistedPreferences = useMemo(
    () => (scope ? readPreferences(scope) : EMPTY_PREFERENCES),
    [scope],
  );

  const preferences =
    storedPreferences.scope === scope
      ? storedPreferences
      : persistedPreferences;
  const dismissedIds = useMemo(
    () => new Set(preferences.dismissedIds),
    [preferences.dismissedIds],
  );
  const readIds = useMemo(
    () => new Set(preferences.readIds),
    [preferences.readIds],
  );
  const notifications = useMemo(
    () =>
      allNotifications
        .filter((notification) => !dismissedIds.has(notification.id))
        .map((notification) => ({
          ...notification,
          isRead: readIds.has(notification.id),
        })),
    [allNotifications, dismissedIds, readIds],
  );

  function save(next: NotificationPreferences) {
    if (!scope) return;
    setStoredPreferences({ scope, ...next });
    writePreferences(scope, next);
  }

  function onMarkAsRead(id: string) {
    if (readIds.has(id)) return;
    save({
      readIds: [...preferences.readIds, id],
      dismissedIds: preferences.dismissedIds,
    });
  }

  function onMarkAllAsRead() {
    save({
      readIds: Array.from(
        new Set([
          ...preferences.readIds,
          ...notifications.map((notification) => notification.id),
        ]),
      ),
      dismissedIds: preferences.dismissedIds,
    });
  }

  function onDismiss(id: string) {
    const notification = notifications.find((item) => item.id === id);
    if (!notification?.dismissible || dismissedIds.has(id)) return;
    save({
      readIds: preferences.readIds,
      dismissedIds: [...preferences.dismissedIds, id],
    });
  }

  return {
    notifications,
    unreadCount: notifications.filter((notification) => !notification.isRead)
      .length,
    onDismiss,
    onMarkAllAsRead,
    onMarkAsRead,
  };
}
