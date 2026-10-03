import { supabase, authStorage } from "./supabaseClient";

/** Leave the browser session even when refresh or remote logout cannot complete. */
export async function signOutFromBrowser(): Promise<void> {
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

  // Clear canonical keys and reject any pending SDK write after local logout.
  // Never clear unrelated preferences, other projects or all browser storage.
  authStorage.clear();

  // Discard in-memory clients, pending refreshes and cached organisation data.
  window.location.replace("/admin/login");
}
