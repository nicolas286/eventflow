import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { AsyncState, Badge, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate, formatMoney } from "../components/platformFormat";

export function PlatformOperationsPage() {
  const query = usePlatformQuery(platformAdminRepo.operations); const data = query.data;
  return <><Helmet><title>Exploitation · Eventflow Platform</title></Helmet><PageHeader eyebrow="Santé des parcours" title="Exploitation" />
    <AsyncState loading={query.loading} error={query.error}>{data ? <div className="platformGrid">
      <Panel title={`Connexions de paiement à traiter (${data.paymentConnections.length})`} className="platformPanel--half"><ul className="platformList">{data.paymentConnections.map((item) => <li key={item.id}><Link to={`/platform/organizations/${item.id}`}><strong>{item.name}</strong></Link> <Badge tone="warning">{item.paymentsStatus}</Badge><div className="platformMuted">{item.paymentsProvider} · live {item.paymentsLiveReady ? "prêt" : "non prêt"}</div></li>)}</ul></Panel>
      <Panel title={`Commandes anciennes (${data.staleOrders.length})`} className="platformPanel--half"><ul className="platformList">{data.staleOrders.map((item) => <li key={item.id}><strong>{item.organizationName}</strong> · {formatMoney(item.totalCents)}<div className="platformMuted">{item.status} depuis {formatDate(item.createdAt)}</div></li>)}</ul></Panel>
      <Panel title={`Échecs e-mail (${data.emailFailures.length})`} className="platformPanel--half"><ul className="platformList">{data.emailFailures.map((item) => <li key={item.id}><strong>{item.organizationName}</strong><div className="platformMuted">{item.error} · {formatDate(item.updatedAt)}</div></li>)}</ul></Panel>
      <Panel title={`Échecs facture / Peppol (${data.invoiceFailures.length})`} className="platformPanel--half"><ul className="platformList">{data.invoiceFailures.map((item) => <li key={item.invoiceId}><strong>{item.organizationName}</strong> <Badge tone="danger">{item.status}</Badge><div className="platformMuted">{item.errorCode ?? "sans code"} · {item.errorMessage ?? "sans détail"}</div></li>)}</ul></Panel>
    </div> : null}</AsyncState>
  </>;
}
