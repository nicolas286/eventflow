import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useAuth } from "@providers/AuthProvider/useAuth";
import { authRepo } from "@app/modules/admin/auth/data/authRepo";
import { normalizeError } from "@errors/errors";
import "../platform.css";

export function PlatformLoginPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!authLoading && user) return <Navigate to="/platform/mfa" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await authRepo.signIn({ email, password }, { rememberMe: false });
      navigate("/platform/mfa", { replace: true });
    } catch (cause) {
      setError(normalizeError(cause, "Connexion impossible.").message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="platformAuth">
      <Helmet><title>Connexion plateforme · Eventflow</title><meta name="robots" content="noindex,nofollow" /></Helmet>
      <form className="platformAuthCard" onSubmit={(event) => void submit(event)}>
        <p className="platformEyebrow">Eventflow interne</p>
        <h1>Back-office plateforme</h1>
        <p>Accès réservé à l’équipe autorisée. Le second facteur est obligatoire.</p>
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Mot de passe<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error ? <p className="platformError" role="alert">{error}</p> : null}
        <button className="platformButton" type="submit" disabled={loading}>{loading ? "Connexion…" : "Continuer"}</button>
      </form>
    </main>
  );
}
