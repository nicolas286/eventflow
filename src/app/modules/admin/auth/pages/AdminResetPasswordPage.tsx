import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";

import { Button } from "@ui/components";
import { MessageBox } from "@ui/components/message/MessageBox";
import { AuthScaffold } from "../components/AuthScaffold";

import { authRepo } from "../data/authRepo";
import { supabase } from "@gateways/supabase/supabaseClient";
import { normalizeError } from "@errors/errors";

import "./auth.desktop.css";
import "./auth.mobile.css";

import { signupSchema } from "../schemas/admin.auth.schema";
import { useLiveForm } from "@shared/hooks/useLiveZodForm";
import { PasswordConfirmFields } from "../components/PasswordConfirmFields";

const resetPasswordSchema = z
  .object({
    password: signupSchema.shape.password,
    confirmPassword: z.string().min(1, "Confirmez le mot de passe."),
  })
  .superRefine((val, ctx) => {
    if (val.password !== val.confirmPassword) {
      ctx.addIssue({
        code: "custom",
        path: ["confirmPassword"],
        message: "Les mots de passe ne correspondent pas.",
      });
    }
  });

type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/** Supabase peut renvoyer des erreurs dans le hash:
 *  #error=access_denied&error_code=otp_expired&error_description=...
 */
function parseSupabaseHashError(): string | null {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#")) return null;

  const params = new URLSearchParams(hash.slice(1));

  const error = params.get("error");
  const errorCode = params.get("error_code");
  const descRaw = params.get("error_description");

  if (!error && !errorCode && !descRaw) return null;

  // decode safe (hash query-style uses + for space)
  const desc = descRaw ? decodeURIComponent(descRaw.replace(/\+/g, " ")) : null;

  if (errorCode === "otp_expired") {
    return "Lien expiré. Recommencez une demande “Mot de passe oublié”.";
  }

  // access_denied est souvent utilisé pour divers refus (invalid/expired, etc.)
  if (error === "access_denied" || errorCode === "access_denied") {
    return "Lien invalide ou expiré. Recommencez une demande “Mot de passe oublié”.";
  }

  return (
    desc ??
    "Lien invalide ou expiré. Recommencez une demande “Mot de passe oublié”."
  );
}

function clearHashFromUrl() {
  // Retire le hash sans recharger la page
  const clean = window.location.pathname + window.location.search;
  window.history.replaceState({}, document.title, clean);
}

export function AdminResetPasswordPage() {
  // Autorise le reset uniquement si on est réellement dans un flow "recovery"
  const [canReset, setCanReset] = useState(false);

  // Message d’erreur lié au lien de recovery (hash error ou exchangeCode fail)
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const live = useLiveForm<ResetPasswordInput>(resetPasswordSchema, {
    password: "",
    confirmPassword: "",
  });

  const { form, fieldErrors, handleChange, handleBlur, shouldShowFieldError } =
    live;

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY") setCanReset(true);
    });

    async function bootstrapRecovery() {
      try {
        if (!mounted) return;
        setCanReset(false);
        setRecoveryError(null);

        const hashErr = parseSupabaseHashError();
        if (hashErr) {
          if (!mounted) return;
          setRecoveryError(hashErr);
          setCanReset(false);
          clearHashFromUrl();
          return;
        }

        // ✅ 1) si une session existe déjà (ex: implicit hash déjà traité), on autorise
        const { data: sess } = await supabase.auth.getSession();
        if (!mounted) return;
        if (sess.session) {
          setCanReset(true);
          return;
        }

        // ✅ 2) sinon, si on est en PKCE avec ?code=..., on échange
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (!code) return;

        const { error } = await supabase.auth.exchangeCodeForSession(
          window.location.href,
        );
        if (error) throw error;

        // (optionnel mais recommandé) enlever le code de l'URL pour éviter double-consommation au refresh
        url.searchParams.delete("code");
        window.history.replaceState(
          {},
          document.title,
          url.pathname + url.search,
        );

        if (!mounted) return;
        setCanReset(true);
      } catch {
        if (!mounted) return;
        setCanReset(false);
        setRecoveryError(
          "Lien invalide ou expiré. Recommencez une demande “Mot de passe oublié”.",
        );
      }
    }

    bootstrapRecovery();

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setOkMsg(null);

    live.touchAll(["password", "confirmPassword"]);
    const parsed = live.validateAll();
    if (!parsed.ok) return;

    try {
      setLoading(true);
      await authRepo.updatePassword(parsed.data.password);
      setOkMsg("Mot de passe mis à jour. Vous pouvez vous reconnecter.");
    } catch (e) {
      const err = normalizeError(e, "Erreur inconnue.");
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!canReset) {
    return (
      <AuthScaffold
        eyebrow="Lien de récupération"
        title="Ce lien n’est plus disponible"
        subtitle="Demandez un nouveau lien pour protéger l’accès à votre compte."
        footer={
          <Link to="/admin/login" className="auth-link">
            Retour à la connexion
          </Link>
        }
      >
        <MessageBox variant="error">
          {recoveryError ??
            "Lien invalide ou expiré. Recommencez une demande “Mot de passe oublié”."}
        </MessageBox>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      eyebrow="Sécurité du compte"
      title="Choisissez un nouveau mot de passe"
      subtitle="Utilisez un mot de passe unique que vous n’employez pas ailleurs."
      footer={
        <Link to="/admin/login" className="auth-link">
          Retour à la connexion
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <PasswordConfirmFields
          live={{
            form,
            fieldErrors,
            handleChange,
            handleBlur,
            shouldShowFieldError,
          }}
          passwordKey="password"
          confirmKey="confirmPassword"
          labels={{
            password: "Nouveau mot de passe",
            confirm: "Confirmer le mot de passe",
          }}
          placeholders={{
            password: "Nouveau mot de passe",
            confirm: "Confirmez le mot de passe",
          }}
          autoComplete="new-password"
          onAnyChange={() => {
            setErrorMsg(null);
            setOkMsg(null);
          }}
        />

        {errorMsg && <MessageBox variant="error">{errorMsg}</MessageBox>}
        {okMsg && <MessageBox variant="success">{okMsg}</MessageBox>}

        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "Mise à jour…" : "Mettre à jour le mot de passe"}
        </Button>
      </form>
    </AuthScaffold>
  );
}
