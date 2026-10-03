import { getSessionClaims } from "./sessionScope";

type BrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** One tab owns its session. Only an explicitly remembered session is shared
 * with future tabs. Never read another tab's identity during token refresh. */
export function createAuthStorage(local: BrowserStorage, tab: BrowserStorage, key: string) {
  const modeKey = `${key}-remember`;
  const keys = [key, `${key}-code-verifier`, `${key}-user`];
  const retiredSessions = new Set<string>();
  let closed = false;
  function storedSessionId(value: string | null) {
    if (value === null) return undefined;
    try {
      const session: unknown = JSON.parse(value);
      if (typeof session === "object" && session !== null && "access_token" in session && typeof session.access_token === "string") {
        return getSessionClaims({ access_token: session.access_token })?.session_id;
      }
    } catch { /* Non-session auxiliary storage. */ }
    return undefined;
  }
  if (tab.getItem(modeKey) === null) {
    const remembered = local.getItem(key) !== null;
    tab.setItem(modeKey, remembered ? "true" : "false");
    if (remembered) {
      for (const name of keys) {
        const value = local.getItem(name);
        if (value !== null) tab.setItem(name, value);
      }
    }
  }

  function forgetPersistentSession() {
    for (const name of keys) local.removeItem(name);
    local.removeItem(modeKey);
  }

  return {
    selectPersistence(remember: boolean) {
      closed = false;
      // Clear the previous account even if the next login fails. Existing tabs
      // keep their own identity, but can no longer persist their old refreshes.
      const previousSession = storedSessionId(tab.getItem(key));
      if (previousSession) retiredSessions.add(previousSession);
      forgetPersistentSession();
      for (const name of keys) tab.removeItem(name);
      tab.setItem(modeKey, remember ? "true" : "false");
    },
    clear() {
      closed = true;
      forgetPersistentSession();
      for (const name of keys) tab.removeItem(name);
      tab.removeItem(modeKey);
    },
    forClient(clientKey: string) {
      const canonical = (name: string) => key + name.slice(clientKey.length);
      return {
        getItem(name: string) {
          const target = canonical(name);
          if (target === key && tab.getItem(modeKey) === "true") {
            const own = tab.getItem(key);
            const persisted = local.getItem(key);
            const ownSession = storedSessionId(own);
            // Remembered tabs may share refreshed tokens of the SAME session.
            // A different account/session must never silently replace this tab.
            if (ownSession && ownSession === storedSessionId(persisted)) {
              for (const storedKey of keys) {
                const value = local.getItem(storedKey);
                if (value !== null) tab.setItem(storedKey, value);
                else tab.removeItem(storedKey);
              }
            } else if (own !== persisted) {
              tab.setItem(modeKey, "false");
            }
          }
          return tab.getItem(target);
        },
        setItem(name: string, value: string) {
          if (closed) throw new Error("AUTH_SESSION_CLOSED");
          const target = canonical(name);
          const sessionId = target === key ? storedSessionId(value) : undefined;
          if (sessionId && retiredSessions.has(sessionId)) throw new Error("AUTH_SESSION_REPLACED");
          const previousSession = target === key ? storedSessionId(tab.getItem(key)) : undefined;
          if (sessionId && previousSession && sessionId !== previousSession) retiredSessions.add(previousSession);
          if (tab.getItem(modeKey) === "true") {
            // Another tab replaced/removed the remembered identity. Detach this
            // tab before it can overwrite that identity with an old refresh.
            const previous = tab.getItem(key);
            const persisted = local.getItem(key);
            if (previous !== null && persisted !== previous) {
              tab.setItem(modeKey, "false");
            } else {
              local.setItem(target, value);
            }
          }
          tab.setItem(target, value);
        },
        removeItem(name: string) {
          const target = canonical(name);
          if (tab.getItem(modeKey) === "true" && local.getItem(target) === tab.getItem(target)) {
            local.removeItem(target);
          }
          tab.removeItem(target);
        },
      };
    },
  };
}
