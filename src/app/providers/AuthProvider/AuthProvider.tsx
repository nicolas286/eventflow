import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User, AuthChangeEvent } from "@supabase/supabase-js";
import { supabase } from "@shared/gateways/supabase/supabaseClient";
import { authRepo } from "@app/modules/admin/auth/data/authRepo";
import { AuthContext, type AuthContextValue } from "./AuthContext";
import type { AppError } from "@shared/errors/errors";
import { normalizeError } from "@shared/errors/errors";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [bootstrapError, setBootstrapError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);

  const signingOutRef = useRef(false);

  useEffect(() => {
    let active = true;
    let authChanged = false;

    (async () => {
      try {
        const s = await authRepo.getSession();
        if (!active || authChanged || signingOutRef.current) return;

        setSession(s);
        setUser(s?.user ?? null);
        setBootstrapError(null);
      } catch (e) {
        if (!active || authChanged || signingOutRef.current) return;
        setBootstrapError(normalizeError(e, "Impossible d'initialiser la session."));
      } finally {
        if (active) setLoading(false);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, newSession: Session | null) => {
        authChanged = true;
        if (!active || signingOutRef.current) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);
        setBootstrapError(null);
      },
    );

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async () => {
    signingOutRef.current = true;
    setSession(null);
    setUser(null);
    await authRepo.signOut();
  }, []);

  const value: AuthContextValue = {
    user,
    session,
    bootstrapError,
    loading,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
