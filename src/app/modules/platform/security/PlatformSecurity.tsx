import { useRef, useState, type ReactNode } from "react";
import { supabase } from "@gateways/supabase/supabaseClient";
import { normalizeError } from "@errors/errors";
import { platformAdminRepo } from "../data/platformAdminRepo";
import type { PlatformAction } from "@contracts/platform-admin";
import { SecurityContext, type SecurityContextValue } from "./PlatformSecurityContext";

type PendingAction = {
  action: PlatformAction;
  targetId: string;
  label: string;
  execute: (token: string) => Promise<unknown>;
  resolve: () => void;
  reject: (error: Error) => void;
};

export function PlatformSecurityProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const activeRef = useRef(false);

  const runCritical: SecurityContextValue["runCritical"] = (action, targetId, label, execute) => {
    if (activeRef.current) return Promise.reject(new Error("PLATFORM_STEP_UP_ALREADY_OPEN"));
    activeRef.current = true;
    setCode("");
    setError(null);
    return new Promise<void>((resolve, reject) => {
      setPending({ action, targetId, label, execute, resolve, reject });
    });
  };

  const close = (reason = "Action annulée") => {
    pending?.reject(new Error(reason));
    activeRef.current = false;
    setPending(null);
    setCode("");
    setError(null);
  };

  const confirm = async () => {
    if (!pending || !/^\d{6}$/.test(code)) {
      setError("Saisissez le code à 6 chiffres de votre application d’authentification.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
      if (factorsError) throw factorsError;
      const factor = factors.totp.find((entry) => entry.status === "verified");
      if (!factor) throw new Error("PLATFORM_MFA_FACTOR_REQUIRED");
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
        factorId: factor.id,
        code,
      });
      if (verifyError) throw verifyError;

      const proof = await platformAdminRepo.stepUp(pending.action, pending.targetId);
      await pending.execute(proof.token);
      pending.resolve();
      activeRef.current = false;
      setPending(null);
      setCode("");
    } catch (cause) {
      setError(normalizeError(cause, "La réauthentification a échoué.").message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SecurityContext.Provider value={{ runCritical }}>
      {children}
      {pending ? (
        <div className="platformModalBackdrop" role="presentation">
          <section className="platformModal" role="dialog" aria-modal="true" aria-labelledby="platform-stepup-title">
            <p className="platformEyebrow">Action sensible</p>
            <h2 id="platform-stepup-title">Réauthentification obligatoire</h2>
            <p>{pending.label}</p>
            <label>
              Code TOTP
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              />
            </label>
            {error ? <p className="platformError" role="alert">{error}</p> : null}
            <div className="platformActions">
              <button className="platformButton platformButton--secondary" disabled={loading} onClick={() => close()}>Annuler</button>
              <button className="platformButton platformButton--danger" disabled={loading} onClick={() => void confirm()}>
                {loading ? "Vérification…" : "Vérifier et exécuter"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </SecurityContext.Provider>
  );
}
