import { createClient, navigatorLock } from "@supabase/supabase-js";
import { createAuthStorage } from "./authStorage";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables");
}

const project = new URL(supabaseUrl).hostname.split(".")[0];
export const authStorage = createAuthStorage(
  window.localStorage, window.sessionStorage, `sb-${project}-auth-token`,
);
// Supabase broadcasts full sessions on storageKey. A channel per runtime keeps
// a different tab's SIGNED_IN event from replacing this tab's AuthProvider while
// its requests still use its own session. The adapter keeps stable storage keys.
const storageKey = `sb-${project}-auth-token-${crypto.randomUUID()}`;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey,
    storage: authStorage.forClient(storageKey),
    // Serialize shared remembered-session refreshes even though notification
    // channels are isolated. Each lock holder rereads the latest stored token.
    ...(navigator.locks ? { lock: <T>(_name: string, timeout: number, run: () => Promise<T>) => navigatorLock(`lock:sb-${project}-auth-token`, timeout, run) } : {}),
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
