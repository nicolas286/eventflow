import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { normalizeError } from "@errors/errors";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { usePlatformSecurity } from "../security/PlatformSecurityContext";
import { AsyncState, Badge, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate, formatMoney } from "../components/platformFormat";

export function PlatformOrganizationPage() {
  const { organizationId = "" } = useParams();
  const query = usePlatformQuery(() => platformAdminRepo.organization(organizationId), organizationId);
  const { runCritical } = usePlatformSecurity();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const data = query.data;
  const actionsReady = !query.loading && !query.error && data?.organization.id === organizationId;
  const providerManagedSubscription = Boolean(data?.subscription && data.subscription.provider !== "manual");
  const changeStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!actionsReady) return;
    setError(null);
    const form = new FormData(event.currentTarget); const status = String(form.get("status"));
    try { await runCritical("organizations.status", organizationId, `Changer le statut de ${data?.organization.name ?? "cette organisation"} vers « ${status} » ?`, (token) => platformAdminRepo.changeOrganization(organizationId, "status", { status, reason }, token)); await query.reload(); }
    catch (cause) { if ((cause instanceof Error ? cause.message : null) !== "Action annulée") setError(normalizeError(cause, "Modification impossible.").message); }
  };
  const changePlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!actionsReady) return;
    setError(null); const form = new FormData(event.currentTarget); const plan = String(form.get("plan")); const days = Number(form.get("days"));
    try { await runCritical("organizations.plan", organizationId, `Appliquer le plan ${plan} pour ${days} jours ?`, (token) => platformAdminRepo.changeOrganization(organizationId, "plan", { plan, days, reason }, token)); await query.reload(); }
    catch (cause) { if ((cause instanceof Error ? cause.message : null) !== "Action annulée") setError(normalizeError(cause, "Modification impossible.").message); }
  };
  const changeOwner = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!actionsReady) return;
    setError(null); const ownerEmail = String(new FormData(event.currentTarget).get("ownerEmail"));
    try { await runCritical("organizations.owner", organizationId, `Transférer la propriété à ${ownerEmail} ?`, (token) => platformAdminRepo.changeOrganization(organizationId, "owner", { ownerEmail, reason }, token)); await query.reload(); }
    catch (cause) { if ((cause instanceof Error ? cause.message : null) !== "Action annulée") setError(normalizeError(cause, "Modification impossible.").message); }
  };
  return <>
    <Helmet><title>{data?.organization.name ?? "Organisation"} · Eventflow Platform</title></Helmet>
    <PageHeader eyebrow="Organisation" title={data?.organization.name ?? "Fiche organisation"}><Link to="/platform/organizations">Retour à la liste</Link></PageHeader>
    <AsyncState loading={query.loading} error={query.error}>{data ? <div className="platformGrid">
      <Panel title="Identité" className="platformPanel--half"><p><Badge tone={data.organization.status === "active" ? "good" : "warning"}>{data.organization.status}</Badge> <Badge>{data.organization.plan}</Badge></p><p>{data.profile?.displayName ?? data.organization.name}</p><p className="platformMuted">{data.profile?.publicEmail ?? "Pas d’e-mail public"} · créé le {formatDate(data.organization.createdAt)}</p></Panel>
      <Panel title="Activité" className="platformPanel--half"><div className="platformKpis"><div className="platformKpi"><span>Événements</span><strong>{data.metrics.events}</strong></div><div className="platformKpi"><span>Commandes</span><strong>{data.metrics.orders}</strong></div><div className="platformKpi"><span>Participants</span><strong>{data.metrics.participants}</strong></div><div className="platformKpi"><span>Payé</span><strong>{formatMoney(data.metrics.paidCents)}</strong></div></div></Panel>
      <Panel title="Membres" className="platformPanel--half"><ul className="platformList">{data.members.map((member) => <li key={member.userId}><strong>{member.firstName} {member.lastName}</strong> <Badge>{member.role}</Badge><div className="platformMuted">{member.email}</div></li>)}</ul></Panel>
      <Panel title="Abonnement & paiement" className="platformPanel--half"><p>Prestataire : <strong>{data.organization.paymentsProvider}</strong> · {data.organization.paymentsStatus}</p><p>Prêt pour le live : <strong>{data.organization.paymentsLiveReady ? "oui" : "non"}</strong></p><p>Abonnement : <strong>{data.subscription?.status ?? "absent"}</strong> · échéance {formatDate(data.subscription?.currentPeriodEnd ?? null)}</p></Panel>
      <Panel title="Actions sensibles"><label>Motif commun<input value={reason} minLength={3} onChange={(event) => setReason(event.target.value)} placeholder="Motif obligatoire, conservé dans l’audit" /></label><div className="platformSplit">
        <form onSubmit={(event) => void changeStatus(event)} className="platformFormGrid"><label>Statut<select name="status" defaultValue={data.organization.status}><option value="trial">trial</option><option value="active">active</option><option value="suspended">suspended</option></select></label><button className="platformButton platformButton--danger" disabled={!actionsReady || reason.trim().length < 3}>Changer le statut</button></form>
        <form onSubmit={(event) => void changePlan(event)} className="platformFormGrid"><label>Plan<select name="plan" defaultValue={data.organization.plan}><option value="free">free</option><option value="starter">starter</option><option value="pro">pro</option></select></label><label>Durée<input name="days" type="number" min={1} max={3650} defaultValue={365} /></label><button className="platformButton platformButton--danger" disabled={!actionsReady || reason.trim().length < 3 || providerManagedSubscription}>Changer le plan</button>{providerManagedSubscription ? <p className="platformMuted">Plan géré par un prestataire : modification manuelle refusée pour éviter de désynchroniser la facturation.</p> : null}</form>
        <form onSubmit={(event) => void changeOwner(event)} className="platformFormGrid"><label>Nouveau propriétaire<input name="ownerEmail" type="email" required /></label><button className="platformButton platformButton--danger" disabled={!actionsReady || reason.trim().length < 3}>Transférer</button></form>
      </div>{error ? <p className="platformError">{error}</p> : null}</Panel>
      <Panel title="Événements récents"><ul className="platformList">{data.recentEvents.map((event) => <li key={event.id}><strong>{event.title}</strong> <Badge tone={event.isPublished ? "good" : "neutral"}>{event.isPublished ? "publié" : "brouillon"}</Badge><div className="platformMuted">{formatDate(event.startsAt)}</div></li>)}</ul></Panel>
    </div> : null}</AsyncState>
  </>;
}
