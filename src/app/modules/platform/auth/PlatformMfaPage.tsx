import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { supabase } from "@gateways/supabase/supabaseClient";
import { normalizeError } from "@errors/errors";
import { platformAdminRepo } from "../data/platformAdminRepo";
import {
  clearPlatformMfaEnrollment,
  preparePlatformMfa,
  type PlatformMfaOperations,
} from "./platformMfaEnrollment";
import "../platform.css";

export function PlatformMfaPage() {
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const userId = user?.id ?? null;
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setFactorId(null);
    setQrCode(null);
    setManualKey(null);
    setCopyStatus(null);

    const operations: PlatformMfaOperations = {
      listFactors: async () => {
        const { data, error: listError } =
          await supabase.auth.mfa.listFactors();
        if (listError) throw listError;
        return data.totp.map((factor) => ({
          id: factor.id,
          status: factor.status,
        }));
      },
      unenroll: async (id) => {
        const { error: unenrollError } = await supabase.auth.mfa.unenroll({
          factorId: id,
        });
        if (unenrollError) throw unenrollError;
      },
      enroll: async () => {
        const { data, error: enrollError } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          friendlyName: "Eventflow Platform",
        });
        if (enrollError) throw enrollError;
        if (!data) throw new Error("MFA enrollment returned no factor.");
        return {
          id: data.id,
          qrCode: data.totp.qr_code,
          secret: data.totp.secret,
        };
      },
    };

    void (async () => {
      try {
        const access = await platformAdminRepo.access();
        if (access.aal === "aal2") {
          navigate("/platform", { replace: true });
          return;
        }

        const preparation = await preparePlatformMfa(userId, operations);
        if (!active) return;
        setFactorId(preparation.factorId);
        setQrCode(
          preparation.kind === "enrollment" ? preparation.qrCode : null,
        );
        setManualKey(
          preparation.kind === "enrollment" ? preparation.secret : null,
        );
      } catch (cause) {
        if (active) {
          setError(
            normalizeError(
              cause,
              "Impossible de préparer la double authentification.",
            ).message,
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [navigate, userId]);

  if (!authLoading && !user) {
    return <Navigate to="/platform/login" replace />;
  }

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!factorId || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify(
        { factorId, code },
      );
      if (verifyError) throw verifyError;
      clearPlatformMfaEnrollment(userId);
      navigate("/platform", { replace: true });
    } catch (cause) {
      setError(normalizeError(cause, "Code invalide ou expiré.").message);
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async () => {
    if (userId) clearPlatformMfaEnrollment(userId);
    await signOut();
  };

  const copyManualKey = async () => {
    if (!manualKey) return;

    try {
      await navigator.clipboard.writeText(manualKey);
      setCopyStatus("Clé copiée.");
    } catch {
      setCopyStatus(
        "Copie automatique impossible. Maintenez la clé pour la sélectionner.",
      );
    }
  };

  return (
    <main className="platformAuth">
      <Helmet>
        <title>Sécurité MFA · Eventflow</title>
        <meta name="robots" content="noindex,nofollow" />
      </Helmet>
      <form
        className="platformAuthCard"
        onSubmit={(event) => void verify(event)}
      >
        <p className="platformEyebrow">Sécurité administrateur</p>
        <h1>
          {qrCode
            ? "Activer la double authentification"
            : "Valider le second facteur"}
        </h1>
        <div className="platformMfaAccount">
          <span>Compte protégé</span>
          <strong>{user?.email}</strong>
        </div>
        {qrCode ? (
          <>
            <p>
              Scannez ce QR code avec votre application d’authentification, puis
              saisissez le code généré. Le QR code restera disponible tant que
              cette activation ne sera pas validée.
            </p>
            <div className="platformQrFrame">
              <img
                className="platformQr"
                src={qrCode}
                alt={`QR code d’enrôlement TOTP pour ${user?.email ?? "ce compte"}`}
              />
            </div>
            {manualKey ? (
              <section
                className="platformManualMfa"
                aria-labelledby="manual-mfa-title"
              >
                <div>
                  <p className="platformManualMfa__eyebrow">
                    Activation sur ce téléphone
                  </p>
                  <h2 id="manual-mfa-title">Saisir une clé de configuration</h2>
                  <p>
                    Dans votre application d’authentification, choisissez «
                    Ajouter un compte », puis « Saisir une clé ». Utilisez
                    l’adresse {user?.email} et le type « Basée sur le temps
                    (TOTP) ».
                  </p>
                </div>
                <div className="platformManualMfa__key">
                  <code>{manualKey}</code>
                  <button
                    className="platformButton platformButton--secondary"
                    type="button"
                    onClick={() => void copyManualKey()}
                  >
                    Copier la clé
                  </button>
                </div>
                {copyStatus ? (
                  <p className="platformManualMfa__status" aria-live="polite">
                    {copyStatus}
                  </p>
                ) : null}
              </section>
            ) : null}
          </>
        ) : (
          <p>
            Un facteur est déjà activé pour ce compte. Saisissez le code actuel
            de votre application d’authentification.
          </p>
        )}
        <label>
          Code à 6 chiffres
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          />
        </label>
        {error ? (
          <p className="platformError" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="platformButton"
          type="submit"
          disabled={loading || !factorId || code.length !== 6}
        >
          {loading ? "Préparation…" : "Valider et accéder"}
        </button>
        <p className="platformMuted">
          Facteur perdu ? Un autre administrateur actif doit faire révoquer puis
          réattribuer l’accès après vérification d’identité. Aucun contournement
          du MFA n’est proposé ici.
        </p>
        <button
          className="platformLinkButton"
          type="button"
          onClick={() => void disconnect()}
        >
          Se déconnecter
        </button>
      </form>
    </main>
  );
}
