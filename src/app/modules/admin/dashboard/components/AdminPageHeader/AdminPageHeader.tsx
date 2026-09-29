import type { ReactNode } from "react";

import "./AdminPageHeader.css";

type AdminPageHeaderProps = {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  visual?: ReactNode;
  meta?: ReactNode;
};

export function AdminPageHeader({
  eyebrow = "Espace organisateur",
  title,
  description,
  actions,
  visual,
  meta,
}: AdminPageHeaderProps) {
  return (
    <header className="adminPageHeader">
      <div className="adminPageHeader__main">
        {visual ? (
          <div className="adminPageHeader__visual">{visual}</div>
        ) : null}

        <div className="adminPageHeader__copy">
          <span className="adminPageHeader__eyebrow">{eyebrow}</span>
          <h1 className="adminPageHeader__title">{title}</h1>
          {description ? (
            <p className="adminPageHeader__description">{description}</p>
          ) : null}
          {meta ? <div className="adminPageHeader__meta">{meta}</div> : null}
        </div>
      </div>

      {actions ? (
        <div className="adminPageHeader__actions">{actions}</div>
      ) : null}
    </header>
  );
}
