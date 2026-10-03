import type { Session } from "@supabase/supabase-js";

/** UI cache key only; JWT claims here never grant server permissions. */
export function getSessionScope(session: Session | null): string | null {
  if (!session) return null;
  const claims = getSessionClaims(session);
  return JSON.stringify([session.user.id, claims?.session_id ?? null]);
}

export function getSessionClaims(session: Pick<Session, "access_token">): { session_id?: string; aal?: string } | null {
  try {
    const payload = session.access_token.split(".")[1];
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof claims !== "object" || claims === null) return null;
    return {
      session_id: "session_id" in claims && typeof claims.session_id === "string" ? claims.session_id : undefined,
      aal: "aal" in claims && typeof claims.aal === "string" ? claims.aal : undefined,
    };
  } catch {
    return null;
  }
}
