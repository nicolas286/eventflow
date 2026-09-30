import { useState } from "react";
import { Helmet } from "react-helmet-async";
import { platformAdminRepo } from "../data/platformAdminRepo";
import { usePlatformQuery } from "../hooks/usePlatformQuery";
import { AsyncState, PageHeader, Panel } from "../components/PlatformUi";
import { formatDate, formatMoney } from "../components/platformFormat";

export function PlatformOverviewPage() {
  const [period, setPeriod] = useState(30);
  const query = usePlatformQuery(() => platformAdminRepo.overview(period), String(period));
  const data = query.data;
  return <>
    <Helmet><title>Vue d’ensemble · Eventflow Platform</title></Helmet>
    <PageHeader eyebrow="Pilotage" title="Vue d’ensemble">
      <label>Période <select value={period} onChange={(event) => setPeriod(Number(event.target.value))}><option value={7}>7 jours</option><option value={30}>30 jours</option><option value={90}>90 jours</option><option value={365}>12 mois</option></select></label>
    </PageHeader>
    <AsyncState loading={query.loading} error={query.error}>{data ? <div className="platformGrid">
      <Panel title="Traction sponsor" className="platformPanel--half"><div className="platformKpis">
        <div className="platformKpi"><span>Organisations</span><strong>{data.organizations.total}</strong><small>+{data.organizations.new30Days} sur 30 jours</small></div>
        <div className="platformKpi"><span>Organisations actives</span><strong>{data.activity.activeOrganizations}</strong><small>{data.activity.activeOrganizationsDefinition}</small></div>
        <div className="platformKpi"><span>Participants</span><strong>{data.activity.participantsPeriod}</strong><small>sur {data.periodDays} jours</small></div>
        <div className="platformKpi"><span>GMV</span><strong>{formatMoney(data.revenue.gmvCents, data.revenue.currency)}</strong><small>volume payé organisateurs</small></div>
      </div></Panel>
      <Panel title="Revenus" className="platformPanel--half"><div className="platformKpis">
        <div className="platformKpi"><span>Revenu Eventflow</span><strong>{formatMoney(data.revenue.eventflowRevenueCents)}</strong><small>abonnements/frais acquis</small></div>
        <div className="platformKpi"><span>Remboursements</span><strong>{formatMoney(data.revenue.refundsCents)}</strong></div>
        <div className="platformKpi"><span>Commandes</span><strong>{data.activity.ordersPeriod}</strong><small>{data.orders.paid} payées</small></div>
        <div className="platformKpi"><span>Billets</span><strong>{data.activity.ticketsPeriod}</strong></div>
      </div></Panel>
      <Panel title="Produit" className="platformPanel--half"><div className="platformKpis">
        <div className="platformKpi"><span>Événements</span><strong>{data.activity.eventsTotal}</strong></div>
        <div className="platformKpi"><span>Publiés</span><strong>{data.activity.eventsPublished}</strong></div>
        <div className="platformKpi"><span>À venir</span><strong>{data.activity.eventsUpcoming}</strong></div>
        <div className="platformKpi"><span>Créés période</span><strong>{data.activity.eventsCreatedPeriod}</strong></div>
      </div></Panel>
      <Panel title="Santé opérationnelle" className="platformPanel--half"><div className="platformKpis">
        <div className="platformKpi"><span>Paiements</span><strong>{data.health.paymentIssues}</strong><small>connexions à traiter</small></div>
        <div className="platformKpi"><span>Commandes anciennes</span><strong>{data.health.staleOrders}</strong></div>
        <div className="platformKpi"><span>E-mails</span><strong>{data.health.emailFailures}</strong></div>
        <div className="platformKpi"><span>Factures</span><strong>{data.health.invoiceFailures}</strong></div>
      </div><p className="platformMuted">Mis à jour le {formatDate(data.updatedAt)} · toutes les valeurs monétaires sont agrégées en centimes côté serveur.</p></Panel>
    </div> : null}</AsyncState>
  </>;
}
