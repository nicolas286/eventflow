import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="platformPageHeader">
      <div className="platformPageHeader__copy">
        <p className="platformEyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description ? (
          <p className="platformPageDescription">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="platformPageHeader__actions">{children}</div>
      ) : null}
    </header>
  );
}

export function Panel({
  id,
  eyebrow,
  title,
  description,
  children,
  className = "",
}: {
  id?: string;
  eyebrow?: string;
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`platformPanel ${className}`}>
      {title || eyebrow || description ? (
        <header className="platformPanelHeader">
          {eyebrow ? <p className="platformEyebrow">{eyebrow}</p> : null}
          {title ? <h2>{title}</h2> : null}
          {description ? <p>{description}</p> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function AsyncState({
  loading,
  error,
  empty,
  children,
}: {
  loading: boolean;
  error: string | null;
  empty?: boolean;
  children: ReactNode;
}) {
  if (loading) return <div className="platformState">Chargement…</div>;
  if (error)
    return (
      <div className="platformState platformError" role="alert">
        {error}
      </div>
    );
  if (empty)
    return (
      <div className="platformState">Aucune donnée pour cette sélection.</div>
    );
  return children;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  return (
    <span className={`platformBadge platformBadge--${tone}`}>{children}</span>
  );
}
