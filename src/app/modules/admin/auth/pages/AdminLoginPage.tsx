import "./auth.desktop.css";
import "./auth.mobile.css";

import { Link } from "react-router-dom";
import { SignInForm } from "@app/modules/admin/auth/components/SignInForm";
import { AuthScaffold } from "../components/AuthScaffold";

export function AdminLoginPage() {
  return (
    <AuthScaffold
      eyebrow="Connexion"
      title="Heureux de vous revoir"
      subtitle="Retrouvez vos événements, vos ventes et vos participants."
      footer={
        <>
          <Link to="/admin/signup" className="auth-link">
            Créer un compte Eventflow
          </Link>
          <Link to="/admin/forgot-password" className="auth-link muted">
            Mot de passe oublié ?
          </Link>
        </>
      }
    >
      <SignInForm />
    </AuthScaffold>
  );
}
