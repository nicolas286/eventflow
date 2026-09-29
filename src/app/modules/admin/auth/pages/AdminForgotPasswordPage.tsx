import { useState } from "react";
import { Button } from "@ui/components";
import { Input } from "@ui/components";
import { MessageBox } from "@ui/components/message/MessageBox";
import { authRepo } from "../data/authRepo";
import { normalizeError } from "@errors/errors";
import "./auth.desktop.css";
import "./auth.mobile.css";
import { Link } from "react-router-dom";
import { AuthScaffold } from "../components/AuthScaffold";

export function AdminForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setOkMsg(null);

    try {
      setLoading(true);
      await authRepo.requestPasswordReset(email, {
        redirectTo: `${window.location.origin}/admin/reset-password`,
      });

      setOkMsg(
        "Si un compte existe pour cette adresse, un email de réinitialisation vient d’être envoyé.",
      );
    } catch (e) {
      const err = normalizeError(e, "Erreur inconnue.");
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthScaffold
      eyebrow="Récupération"
      title="Retrouvez l’accès à votre espace"
      subtitle="Indiquez votre adresse e-mail. Nous vous enverrons un lien sécurisé."
      footer={
        <Link to="/admin/login" className="auth-link">
          Retour à la connexion
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="auth-form">
        <Input
          label="E-mail"
          type="email"
          placeholder="vous@organisation.be"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
        />

        {errorMsg && <MessageBox variant="error">{errorMsg}</MessageBox>}
        {okMsg && <MessageBox variant="success">{okMsg}</MessageBox>}

        <Button type="submit" variant="primary" disabled={loading}>
          {loading ? "Envoi…" : "Recevoir le lien"}
        </Button>
      </form>
    </AuthScaffold>
  );
}
