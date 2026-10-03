import { useState, type FormEvent } from "react";
import { Helmet } from "react-helmet-async";
import { normalizeError } from "@errors/errors";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { usePlatformSecurity } from "../security/PlatformSecurityContext";
import { AsyncState, Badge, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate } from "../components/platformFormat";

export function PlatformAdminsPage() {
  const query = usePlatformQuery(platformAdminRepo.admins); const { runCritical } = usePlatformSecurity();
  const [error, setError] = useState<string | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const grant = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const formElement = event.currentTarget;
    const form = new FormData(formElement); const email = String(form.get("email")).trim().toLowerCase(); const reason = String(form.get("reason")); const note = String(form.get("note"));
    try { await runCritical("admins.grant", email, `Accorder à ${email} un accès complet au back-office plateforme ?`, (token) => platformAdminRepo.changeAdmin("grant", { email, reason, note }, token)); await query.reload(); formElement.reset(); }
    catch (cause) { if ((cause instanceof Error ? cause.message : null) !== "Action annulée") setError(normalizeError(cause, "Attribution impossible.").message); }
  };
  const revoke = async (userId: string, email: string) => {
    const reason = revokeReason.trim(); if (reason.length < 3) { setError("Indiquez un motif de révocation."); return; }
    try { await runCritical("admins.revoke", userId, `Révoquer immédiatement l’accès plateforme de ${email} ?`, (token) => platformAdminRepo.changeAdmin("revoke", { email, reason }, token)); setRevokeReason(""); await query.reload(); }
    catch (cause) { if ((cause instanceof Error ? cause.message : null) !== "Action annulée") setError(normalizeError(cause, "Révocation impossible.").message); }
  };
  return <><Helmet><title>Administrateurs · Eventflow Platform</title></Helmet><PageHeader eyebrow="Accès internes" title="Administrateurs plateforme" />
    <div className="platformGrid"><Panel title="Accorder un accès"><form onSubmit={(event) => void grant(event)} className="platformFormGrid"><label>E-mail d’un compte existant<input name="email" type="email" required /></label><label>Note interne<input name="note" maxLength={1000} /></label><label>Motif<input name="reason" minLength={3} maxLength={1000} required /></label><button className="platformButton platformButton--danger">Réauthentifier et accorder</button></form>{error ? <p className="platformError">{error}</p> : null}</Panel>
      <Panel title="Registre privé"><label>Motif de la prochaine révocation<input value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} minLength={3} maxLength={1000} /></label><AsyncState loading={query.loading} error={query.error}><div className="platformTableWrap"><table className="platformTable"><thead><tr><th>Compte</th><th>Accordé le</th><th>État</th><th></th></tr></thead><tbody>{query.data?.items.map((item) => <tr key={item.userId}><td><strong>{item.email}</strong><div className="platformMuted">{item.firstName} {item.lastName} · {item.note}</div></td><td>{formatDate(item.grantedAt)}</td><td><Badge tone={item.revokedAt ? "danger" : "good"}>{item.revokedAt ? `révoqué ${formatDate(item.revokedAt)}` : "actif"}</Badge></td><td>{!item.revokedAt ? <button className="platformButton platformButton--danger" disabled={revokeReason.trim().length < 3} onClick={() => void revoke(item.userId, item.email)}>Révoquer</button> : null}</td></tr>)}</tbody></table></div></AsyncState></Panel></div>
  </>;
}
