import { useMemo, type ReactNode } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";

import { formatMoney } from "@app/modules/public/register/helpers/checkoutStore";
import { formatDateTimeHuman } from "@helpers/dateTime";
import { isPastEvent } from "@helpers/isPastEvent";
import { Button, Card, CardBody, CardHeader } from "@ui/components";
import {
  CalendarIcon,
  CoinsIcon,
  EyeIcon,
  PlusIcon,
  UsersIcon,
} from "@ui/components/icon/Icons";

import type { AdminOutletContext } from "../components/AdminDashboard";
import { AdminPageHeader } from "../components/AdminPageHeader/AdminPageHeader";

import "./AdminOverviewPage.css";

function eventTimestamp(value?: string | null) {
  if (!value) return Number.POSITIVE_INFINITY;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
}

export function AdminOverviewPage() {
  const { bootstrap, events } = useOutletContext<AdminOutletContext>();
  const navigate = useNavigate();

  const upcomingEvents = useMemo(
    () =>
      events
        .filter((row) => !isPastEvent(row.event))
        .sort(
          (left, right) =>
            eventTimestamp(left.event.startsAt) -
            eventTimestamp(right.event.startsAt),
        ),
    [events],
  );

  const totalOrders = events.reduce((sum, row) => sum + row.ordersCount, 0);
  const paidCents = events.reduce((sum, row) => sum + row.paidCents, 0);
  const publishedCount = events.filter((row) => row.event.isPublished).length;
  const nextEvent = upcomingEvents[0] ?? null;
  const visibleEvents = upcomingEvents.slice(0, 4);
  const profile = bootstrap.organizationProfile;
  const publicPath = profile?.slug ? `/o/${profile.slug}` : null;
  const firstName = bootstrap.profile.firstName?.trim();

  const readinessItems = [
    {
      label: "Page publique",
      ready: Boolean(profile?.slug),
      detail: profile?.slug ? "Adresse configurée" : "Slug à configurer",
      to: "/admin/structure",
    },
    {
      label: "Présentation",
      ready: Boolean(profile?.description?.trim()),
      detail: profile?.description?.trim()
        ? "Description renseignée"
        : "Description manquante",
      to: "/admin/structure",
    },
    {
      label: "Identité visuelle",
      ready: Boolean(profile?.logoUrl || profile?.defaultEventBannerUrl),
      detail:
        profile?.logoUrl || profile?.defaultEventBannerUrl
          ? "Visuels ajoutés"
          : "Logo ou bannière à ajouter",
      to: "/admin/branding",
    },
  ];

  return (
    <div className="adminOverview">
      <AdminPageHeader
        eyebrow={firstName ? `Bonjour ${firstName}` : "Pilotage"}
        title="Vue d’ensemble"
        description="Retrouvez les indicateurs utiles et les prochaines actions pour piloter votre activité sans parcourir chaque écran."
        actions={
          <>
            {publicPath ? (
              <a
                className="adminOverview__secondaryAction"
                href={publicPath}
                target="_blank"
                rel="noreferrer"
              >
                <EyeIcon />
                Page publique
              </a>
            ) : null}
            <Button onClick={() => navigate("/admin/events")}>
              <PlusIcon />
              Gérer les événements
            </Button>
          </>
        }
      />

      <section className="adminOverview__metrics" aria-label="Indicateurs clés">
        <OverviewMetric
          label="Événements"
          value={events.length}
          hint={`${publishedCount} publié${publishedCount > 1 ? "s" : ""}`}
          icon={<CalendarIcon />}
        />
        <OverviewMetric
          label="À venir"
          value={upcomingEvents.length}
          hint={
            nextEvent
              ? "Prochain événement planifié"
              : "Aucun événement planifié"
          }
          icon={<EyeIcon />}
        />
        <OverviewMetric
          label="Commandes"
          value={totalOrders}
          hint="Tous événements confondus"
          icon={<UsersIcon />}
        />
        <OverviewMetric
          label="Recettes"
          value={formatMoney(paidCents, "€")}
          hint="Montant encaissé remonté"
          icon={<CoinsIcon />}
        />
      </section>

      <div className="adminOverview__mainGrid">
        <Card className="adminOverview__eventsCard">
          <CardHeader
            title="Prochains événements"
            subtitle="Les rendez-vous à surveiller en priorité."
            right={
              <Link className="adminOverview__textLink" to="/admin/events">
                Tout afficher
              </Link>
            }
          />
          <CardBody>
            {visibleEvents.length === 0 ? (
              <div className="adminOverview__empty">
                <CalendarIcon />
                <strong>Aucun événement à venir</strong>
                <span>
                  Créez un événement pour commencer à recevoir des inscriptions.
                </span>
                <Button onClick={() => navigate("/admin/events")}>
                  Créer un événement
                </Button>
              </div>
            ) : (
              <div className="adminOverview__eventList">
                {visibleEvents.map((row, index) => (
                  <Link
                    key={row.event.id}
                    className="adminOverview__eventRow"
                    to={`/admin/events/${row.event.slug}`}
                  >
                    <span
                      className="adminOverview__eventDate"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span className="adminOverview__eventCopy">
                      <strong>
                        {row.event.title || "Événement sans titre"}
                      </strong>
                      <span>{formatDateTimeHuman(row.event.startsAt)}</span>
                    </span>
                    <span className="adminOverview__eventStats">
                      {row.ordersCount} commande{row.ordersCount > 1 ? "s" : ""}
                    </span>
                    <span
                      className={`adminOverview__status${
                        row.event.isPublished ? " isPublished" : ""
                      }`}
                    >
                      {row.event.isPublished ? "Publié" : "Brouillon"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card className="adminOverview__readinessCard">
          <CardHeader
            title="Préparation de l’espace public"
            subtitle="Les essentiels pour inspirer confiance aux participants."
          />
          <CardBody>
            <div className="adminOverview__readinessList">
              {readinessItems.map((item) => (
                <Link
                  key={item.label}
                  className="adminOverview__readinessItem"
                  to={item.to}
                >
                  <span
                    className={`adminOverview__readinessDot${
                      item.ready ? " isReady" : ""
                    }`}
                    aria-hidden="true"
                  />
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <span className="adminOverview__readinessState">
                    {item.ready ? "Prêt" : "À compléter"}
                  </span>
                </Link>
              ))}
            </div>

            <div className="adminOverview__plan">
              <span>Plan actuel</span>
              <strong>{bootstrap.organization?.plan ?? "free"}</strong>
              <Link to="/admin/abonnement">Gérer l’abonnement</Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: ReactNode;
}) {
  return (
    <article className="adminOverviewMetric">
      <div className="adminOverviewMetric__icon" aria-hidden="true">
        {icon}
      </div>
      <div>
        <span className="adminOverviewMetric__label">{label}</span>
        <strong className="adminOverviewMetric__value">{value}</strong>
        <small className="adminOverviewMetric__hint">{hint}</small>
      </div>
    </article>
  );
}
