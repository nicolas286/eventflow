import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { supabase } from "@gateways/supabase/supabaseClient";
import { normalizeError } from "@errors/errors";
import { platformAdminRepo } from "../data/platformAdminRepo";
import "../platform.css";

type Factor = { id: string; status: string };

export function PlatformMfaPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [factor, setFactor] = useState<Factor | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void (async () => {
      try {
        const access = await platformAdminRepo.access();
        if (access.aal === "aal2") {
          navigate("/platform", { replace: true });
          return;
        }
        const { data, error: listError } = await supabase.auth.mfa.listFactors();
        if (listError) throw listError;
        const verified = data.totp.find((item) => item.status === "verified");
        if (verified) {
          if (active) setFactor(verified);
          return;
        }
        for (const staleFactor of data.totp.filter((item) => item.status !== "verified")) {
          const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: staleFactor.id });
          if (unenrollError && unenrollError.code !== "mfa_factor_not_found") throw unenrollError;
        }
        let enrollmentResult = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Eventflow Platform",
        });

        // A previous render or interrupted enrollment can create the factor
        // before this request completes. Clear only unverified TOTP factors and
        // retry once so the administrator receives a usable QR code.
        if (enrollmentResult.error?.code === "mfa_factor_name_conflict") {
          const { data: conflictingFactors, error: conflictingFactorsError } = await supabase.auth.mfa.listFactors();
          if (conflictingFactorsError) throw conflictingFactorsError;
          for (const staleFactor of conflictingFactors.totp.filter((item) => item.status !== "verified")) {
            const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId: staleFactor.id });
            if (unenrollError && unenrollError.code !== "mfa_factor_not_found") throw unenrollError;
          }
          enrollmentResult = await supabase.auth.mfa.enroll({
            factorType: "totp",
            friendlyName: "Eventflow Platform",
          });
        }

        if (enrollmentResult.error) throw enrollmentResult.error;
        const enrollment = enrollmentResult.data;
        if (!enrollment) throw new Error("MFA enrollment returned no factor.");
        if (active) {
          setFactor({ id: enrollment.id, status: "unverified" });
          setQrCode(enrollment.totp.qr_code);
        }
      } catch (cause) {
        if (active) setError(normalizeError(cause, "Impossible de préparer la double authentification.").message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [navigate, user]);

  if (!authLoading && !user) return <Navigate to="/platform/login" replace />;

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!factor) return;
    setLoading(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
      if (verifyError) throw verifyError;
      navigate("/platform", { replace: true });
    } catch (cause) {
      setError(normalizeError(cause, "Code invalide ou expiré.").message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="platformAuth">
      <Helmet><title>Sécurité MFA · Eventflow</title><meta name="robots" content="noindex,nofollow" /></Helmet>
      <form className="platformAuthCard" onSubmit={(event) => void verify(event)}>
        <p className="platformEyebrow">Sécurité administrateur</p>
        <h1>{qrCode ? "Activer la double authentification" : "Valider le second facteur"}</h1>
        {qrCode ? <><p>Scannez ce QR code avec votre application d’authentification, puis saisissez le code généré.</p><img className="platformQr" src={qrCode} alt="QR code d’enrôlement TOTP" /></> : <p>Saisissez le code actuel de votre application d’authentification.</p>}
        <label>Code à 6 chiffres<input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} /></label>
        {error ? <p className="platformError" role="alert">{error}</p> : null}
        <button className="platformButton" type="submit" disabled={loading || !factor}>{loading ? "Vérification…" : "Valider"}</button>
        <p className="platformMuted">Facteur perdu ? Un autre administrateur actif doit faire révoquer puis réattribuer l’accès après vérification d’identité. Aucun contournement du MFA n’est proposé ici.</p>
        <button className="platformLinkButton" type="button" onClick={() => void signOut()}>Se déconnecter</button>
      </form>
    </main>
  );
}
