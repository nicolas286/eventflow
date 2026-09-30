import "./auth.desktop.css";
import "./auth.mobile.css";

import { Link } from "react-router-dom";
import { SignUpForm } from "@app/modules/admin/auth/components/SignupForm";
import { MessageBox } from "@ui/components/message/MessageBox";
import { EventFlowLogo } from "@ui/components/branding/EventFlowLogo";
import PublicFooter from "@ui/components/publicFooter/PublicFooter";

export function AdminSignUpPage() {
  // The deployment target validates this public backend URL against deploy/environments.json.
  const signupsPaused =
    import.meta.env.VITE_SUPABASE_URL ===
    "https://dixirvllhfkvqoahhfqh.supabase.co";

  return (
    <div className="auth-page">
      <div className="auth-card">
        
        <EventFlowLogo/>

        <div className="auth-header">
          <h1 className="auth-title">
            {signupsPaused ? "Inscriptions temporairement clôturées" : "Créer un compte Eventflow"}
          </h1>
          <p className="auth-subtitle">
            {signupsPaused
              ? "Nous effectuons une maintenance. Les comptes existants peuvent toujours se connecter."
              : "Inscrivez-vous pour commencer à gérer vos événements"}
          </p>
        </div>

        {signupsPaused ? (
          <MessageBox variant="info">
            Les nouvelles inscriptions sont clôturées pour le moment. Merci de
            votre compréhension.
          </MessageBox>
        ) : (
          <SignUpForm />
        )}

        <div className="auth-links">
          <Link to="/admin/login" className="auth-link">
            Déjà un compte ? Se connecter
          </Link>
        </div>
      </div>
              <PublicFooter />
      
    </div>
  );
}
