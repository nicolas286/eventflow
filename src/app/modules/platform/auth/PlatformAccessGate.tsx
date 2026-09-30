import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { normalizeError } from "@errors/errors";
import { platformAdminRepo } from "../data/platformAdminRepo";

type State = "loading" | "allowed" | "mfa" | "denied";

export function PlatformAccessGate({ children }: { children: ReactNode }) {
  const { user, loading: authLoading, signOut } = useAuth();
  const [state, setState] = useState<State>("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (authLoading || !user) return;
    let active = true;
    void platformAdminRepo.access().then((access) => {
      if (!active) return;
      setState(access.aal === "aal2" ? "allowed" : "mfa");
    }).catch((cause) => {
      if (!active) return;
      setMessage(normalizeError(cause, "Accès plateforme refusé.").message);
      setState("denied");
    });
    return () => { active = false; };
  }, [authLoading, user]);

  if (authLoading) return <div className="platformCentered">Vérification de la session sécurisée…</div>;
  if (!user) return <Navigate to="/platform/login" replace />;
  if (state === "loading") return <div className="platformCentered">Vérification de la session sécurisée…</div>;
  if (state === "mfa") return <Navigate to="/platform/mfa" replace />;
  if (state === "denied") {
    return <main className="platformCentered"><section className="platformAuthCard"><h1>Accès refusé</h1><p>{message}</p><button className="platformButton" onClick={() => void signOut()}>Se déconnecter</button></section></main>;
  }
  return children;
}
