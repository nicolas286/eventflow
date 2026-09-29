import "./auth.desktop.css";
import "./auth.mobile.css";

import { Link } from "react-router-dom";
import { SignUpForm } from "@app/modules/admin/auth/components/SignupForm";
import { AuthScaffold } from "../components/AuthScaffold";

export function AdminSignUpPage() {
  return (
    <AuthScaffold
      eyebrow="Créer votre espace"
      title="Lancez votre prochain événement"
      subtitle="Créez votre compte, puis personnalisez votre organisation en quelques minutes."
      footer={
        <>
          <Link to="/admin/login" className="auth-link">
            Déjà un compte ? Se connecter
          </Link>
        </>
      }
    >
      <SignUpForm />
    </AuthScaffold>
  );
}
