import { Helmet } from "react-helmet-async";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { AsyncState, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate, formatMoney } from "../components/platformFormat";

export function PlatformFinancePage() {
  const query = usePlatformQuery(platformAdminRepo.finance);
  const data = query.data;
  return <><Helmet><title>Finance · Eventflow Platform</title></Helmet><PageHeader eyebrow="Suivi financier" title="Abonnements & paiements" />
    <AsyncState loading={query.loading} error={query.error}>{data ? <div className="platformGrid">
      <Panel title="Flux de paiement"><div className="platformKpis"><div className="platformKpi"><span>Payé</span><strong>{formatMoney(data.paymentTotals.paidCents)}</strong></div><div className="platformKpi"><span>Remboursé</span><strong>{formatMoney(data.paymentTotals.refundedCents)}</strong></div><div className="platformKpi"><span>En attente</span><strong>{data.paymentTotals.pendingCount}</strong></div><div className="platformKpi"><span>Échecs</span><strong>{data.paymentTotals.failedCount}</strong></div></div></Panel>
      <Panel title="Abonnements" className="platformPanel--half"><div className="platformTableWrap"><table className="platformTable"><thead><tr><th>Organisation</th><th>Plan</th><th>Statut</th><th>Échéance</th></tr></thead><tbody>{data.subscriptions.map((item) => <tr key={item.orgId}><td>{item.organizationName}</td><td>{item.plan ?? "—"}</td><td>{item.status}</td><td>{formatDate(item.currentPeriodEnd)}</td></tr>)}</tbody></table></div></Panel>
      <Panel title="Factures" className="platformPanel--half"><div className="platformTableWrap"><table className="platformTable"><thead><tr><th>Numéro</th><th>Organisation</th><th>Statut</th><th>Total</th></tr></thead><tbody>{data.invoices.map((item) => <tr key={item.id}><td>{item.number ?? "—"}</td><td>{item.organizationName}</td><td>{item.status}</td><td>{formatMoney(item.totalCents, item.currency)}</td></tr>)}</tbody></table></div></Panel>
    </div> : null}</AsyncState>
  </>;
}
