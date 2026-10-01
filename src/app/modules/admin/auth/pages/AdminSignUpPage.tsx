import "./auth.desktop.css";
import "./auth.mobile.css";

import { Link } from "react-router-dom";
import { SignUpForm } from "@app/modules/admin/auth/components/SignupForm";
import { AuthScaffold } from "../components/AuthScaffold";
import { MessageBox } from "@ui/components/message/MessageBox";

export function AdminSignUpPage() {
  // The deployment target validates this public backend URL against deploy/environments.json.
  const signupsPaused =
    import.meta.env.VITE_SUPABASE_URL ===
    "https://dixirvllhfkvqoahhfqh.supabase.co";

  return (
    <AuthScaffold
      eyebrow="Créer votre espace"
      title={signupsPaused ? "Inscriptions temporairement clôturées" : "Lancez votre prochain événement"}
      subtitle={signupsPaused
        ? "Nous effectuons une maintenance. Les comptes existants peuvent toujours se connecter."
        : "Créez votre compte, puis personnalisez votre organisation en quelques minutes."}
      footer={
        <Link to="/admin/login" className="auth-link">
          Déjà un compte ? Se connecter
        </Link>
      }
    >
      {signupsPaused ? (
        <MessageBox variant="info">
          Les nouvelles inscriptions sont clôturées pour le moment. Merci de
          votre compréhension.
        </MessageBox>
      ) : (
        <SignUpForm />
      )}
    </AuthScaffold>
  );
}
