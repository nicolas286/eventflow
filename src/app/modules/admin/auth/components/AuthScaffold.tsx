import type { ReactNode } from "react";
import PublicFooter from "@ui/components/publicFooter/PublicFooter";
import { EventFlowLogo } from "@ui/components/branding/EventFlowLogo";

type Props = {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthScaffold({
  eyebrow,
  title,
  subtitle,
  children,
  footer,
}: Props) {
  return (
    <div className="auth-page">
      <div className="auth-shell">
        <aside className="auth-brandPanel">
          <EventFlowLogo />
          <div className="auth-brandCopy">
            <span className="auth-eyebrow">La billetterie à votre image</span>
            <h2>Organisez, vendez et accueillez plus sereinement.</h2>
            <p>
              Un espace unique pour gérer vos événements, vos participants et
              vos paiements.
            </p>
          </div>
          <ul className="auth-benefits" aria-label="Avantages Eventflow">
            <li>Parcours participant personnalisable</li>
            <li>Pilotage clair des inscriptions</li>
            <li>Paiements et billets réunis</li>
          </ul>
        </aside>

        <main className="auth-card">
          <header className="auth-header">
            <span className="auth-eyebrow">{eyebrow}</span>
            <h1 className="auth-title">{title}</h1>
            <p className="auth-subtitle">{subtitle}</p>
          </header>
          {children}
          {footer ? <div className="auth-links">{footer}</div> : null}
        </main>
      </div>
      <PublicFooter />
    </div>
  );
}
