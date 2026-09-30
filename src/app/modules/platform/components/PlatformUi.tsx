import type { ReactNode } from "react";

export function PageHeader({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <header className="platformPageHeader"><div><p className="platformEyebrow">{eyebrow}</p><h1>{title}</h1></div>{children}</header>;
}

export function Panel({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return <section className={`platformPanel ${className}`}>{title ? <h2>{title}</h2> : null}{children}</section>;
}

export function AsyncState({ loading, error, empty, children }: { loading: boolean; error: string | null; empty?: boolean; children: ReactNode }) {
  if (loading) return <div className="platformState">Chargement…</div>;
  if (error) return <div className="platformState platformError" role="alert">{error}</div>;
  if (empty) return <div className="platformState">Aucune donnée pour cette sélection.</div>;
  return children;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "danger" }) {
  return <span className={`platformBadge platformBadge--${tone}`}>{children}</span>;
}
