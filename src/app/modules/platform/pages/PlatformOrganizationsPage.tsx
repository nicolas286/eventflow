import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { AsyncState, Badge, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate, formatMoney } from "../components/platformFormat";

export function PlatformOrganizationsPage() {
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [paymentsStatus, setPaymentsStatus] = useState("");
  const [paymentsProvider, setPaymentsProvider] = useState("");
  const [cursor, setCursor] = useState<{ createdAt: string; id: string } | null>(null);
  const [history, setHistory] = useState<Array<{ createdAt: string; id: string } | null>>([]);
  const params = useMemo(() => {
    const value = new URLSearchParams({ limit: "50" });
    if (search) value.set("search", search);
    if (status) value.set("status", status);
    if (plan) value.set("plan", plan);
    if (paymentsStatus) value.set("paymentsStatus", paymentsStatus);
    if (paymentsProvider) value.set("paymentsProvider", paymentsProvider);
    if (cursor) { value.set("cursorCreatedAt", cursor.createdAt); value.set("cursorId", cursor.id); }
    return value;
  }, [cursor, paymentsProvider, paymentsStatus, plan, search, status]);
  const query = usePlatformQuery(() => platformAdminRepo.organizations(params), params.toString());
  const submit = (event: FormEvent) => { event.preventDefault(); setCursor(null); setHistory([]); setSearch(draft.trim()); };
  return <>
    <Helmet><title>Organisations · Eventflow Platform</title></Helmet>
    <PageHeader eyebrow="Comptes" title="Organisations" />
    <Panel><form className="platformToolbar" onSubmit={submit}>
      <label>Recherche<input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Nom, slug ou propriétaire" /></label>
      <label>Statut<select value={status} onChange={(event) => { setStatus(event.target.value); setCursor(null); setHistory([]); }}><option value="">Tous</option><option value="trial">Essai</option><option value="active">Actif</option><option value="suspended">Suspendu</option></select></label>
      <label>Plan<select value={plan} onChange={(event) => { setPlan(event.target.value); setCursor(null); setHistory([]); }}><option value="">Tous</option><option value="free">Free</option><option value="starter">Starter</option><option value="pro">Pro</option></select></label>
      <label>Prestataire<select value={paymentsProvider} onChange={(event) => { setPaymentsProvider(event.target.value); setCursor(null); setHistory([]); }}><option value="">Tous</option><option value="stripe">Stripe</option><option value="mollie">Mollie</option><option value="bank_transfer">Virement</option></select></label>
      <label>Paiement<select value={paymentsStatus} onChange={(event) => { setPaymentsStatus(event.target.value); setCursor(null); setHistory([]); }}><option value="">Tous</option><option value="connected">Connecté</option><option value="not_connected">Non connecté</option><option value="pending">En attente</option><option value="revoked">Révoqué</option></select></label>
      <button className="platformButton" type="submit">Rechercher</button>
    </form></Panel>
    <Panel>
      <AsyncState loading={query.loading} error={query.error} empty={query.data?.items.length === 0}>
        <div className="platformTableWrap"><table className="platformTable"><thead><tr><th>Organisation</th><th>Propriétaire</th><th>Plan</th><th>Statut</th><th>Événements</th><th>Commandes</th><th>Volume payé</th><th>Création</th></tr></thead><tbody>
          {query.data?.items.map((org) => <tr key={org.id}><td><Link to={`/platform/organizations/${org.id}`}>{org.name}</Link><div className="platformMuted">{org.slug ?? org.type}</div></td><td>{org.ownerEmail ?? "—"}</td><td><Badge>{org.plan}</Badge></td><td><Badge tone={org.status === "active" ? "good" : org.status === "suspended" ? "danger" : "warning"}>{org.status}</Badge></td><td>{org.eventsCount}</td><td>{org.ordersCount}</td><td>{formatMoney(org.paidCents)}</td><td>{formatDate(org.createdAt)}</td></tr>)}
        </tbody></table></div>
      </AsyncState>
      <div className="platformActions"><button className="platformButton platformButton--secondary" disabled={history.length === 0} onClick={() => { const previous = history.at(-1) ?? null; setHistory((items) => items.slice(0, -1)); setCursor(previous); }}>Page précédente</button><button className="platformButton platformButton--secondary" disabled={!query.data?.nextCursor} onClick={() => { if (!query.data?.nextCursor) return; setHistory((items) => [...items, cursor]); setCursor(query.data.nextCursor); }}>Page suivante</button></div>
    </Panel>
  </>;
}
