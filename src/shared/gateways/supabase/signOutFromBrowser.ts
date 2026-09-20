import { supabase } from "./supabaseClient";

/** Leave the browser session even when refresh or remote logout cannot complete. */
export async function signOutFromBrowser(): Promise<void> {
  const project = new URL(import.meta.env.VITE_SUPABASE_URL).hostname.split(".")[0];
  const storageKey = `sb-${project}-auth-token`;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    // Preserve the existing global revocation attempt, but do not let a stale
    // refresh token, network failure or SDK lock trap the user in the UI.
    await Promise.race([
      Promise.resolve().then(() => supabase.auth.signOut()),
      new Promise<void>((resolve) => { timeout = setTimeout(resolve, 5000); }),
    ]);
  } catch {
    // Remote revocation is best effort; local logout must still work.
  } finally {
    clearTimeout(timeout);
  }

  // Both clients use this key: the persistent client and the session client.
  // Never clear unrelated preferences, other projects or all browser storage.
  for (const storage of [window.localStorage, window.sessionStorage]) {
    for (const key of [storageKey, `${storageKey}-code-verifier`, `${storageKey}-user`]) {
      storage.removeItem(key);
    }
  }

  // Discard in-memory clients, pending refreshes and cached organisation data.
  window.location.replace("/admin/login");
}
