import { useNavigate } from "react-router-dom";
import { useEventRibbon } from "../EventSoonRibbon/useEventRibbon";

import type { PublicEventOverview } from "../../schemas/public.orgEventsOverview.schema";

import { formatDateTimeHuman } from "@shared/helpers/dateTime";
import { Badge, Button, CardBody, Card } from "@shared/ui/components";
import {
  CalendarIcon,
  PinIcon,
  TicketIcon,
} from "@shared/ui/components/icon/Icons";
import { EventSoonRibbon } from "../EventSoonRibbon/EventSoonRibbon";
import {
  getEventBadgeToneAndLabel,
  getEventCta,
  getRegistrationMicrocopy,
} from "./eventCard.logic";

import "./OrgEventCard.css";

type OrgEventCardProps = {
  e: PublicEventOverview;
  nowTs: number;
  orgSlug?: string;
};

export function OrgEventCard({ e, nowTs, orgSlug }: OrgEventCardProps) {
  const navigate = useNavigate();

  const banner = e.bannerUrl;
  const startText = e.startsAt ? formatDateTimeHuman(e.startsAt) : null;

  const registrationMicrocopy = getRegistrationMicrocopy(e, nowTs);
  const ribbon = useEventRibbon(e, nowTs);
  const badgeData = getEventBadgeToneAndLabel(e, nowTs);
  const cta = getEventCta(e);

  const handleNavigate = () => {
    if (!cta.disabled) {
      navigate(`/o/${orgSlug}/e/${e.slug}`);
    }
  };

  return (
    <Card
      className={`publicOrgEventCard ${!cta.disabled ? "isClickable" : ""} ${ribbon ? "isHighlighted" : ""}`}
      role={!cta.disabled ? "link" : undefined}
      tabIndex={!cta.disabled ? 0 : undefined}
      onClick={!cta.disabled ? handleNavigate : undefined}
      onKeyDown={
        !cta.disabled
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleNavigate();
              }
            }
          : undefined
      }
    >
      {ribbon ? (
        <EventSoonRibbon label={ribbon.label} type={ribbon.type} />
      ) : null}

      {banner ? (
        <div
          className="publicOrgEventBanner"
          style={{ backgroundImage: `url("${banner}")` }}
          aria-label={e.title}
        />
      ) : null}

      <CardBody className="publicOrgEventBody">
        <div className="publicOrgEventTop">
          <div className="publicOrgEventHeaderRow">
            <div className="publicOrgEventTitle">{e.title}</div>
            {badgeData ? (
              <Badge tone={badgeData.tone} label={badgeData.label} />
            ) : null}
          </div>

          <div className="publicOrgEventLocation">
            <PinIcon />
            {e.location ?? "Lieu à venir"}
          </div>

          {startText ? (
            <div className="publicOrgEventDates">
              <span>
                <CalendarIcon />
                {startText}
              </span>
            </div>
          ) : null}
        </div>

        <div className="publicOrgEventFooter">
          <div className="publicOrgEventActions">
            <Button
              className="publicOrgEventCta"
              variant="primary"
              title={cta.title}
              aria-label={cta.title}
              onClick={(event) => {
                event.stopPropagation();
                if (!cta.disabled) handleNavigate();
              }}
              disabled={cta.disabled}
            >
              <TicketIcon />
              {cta.label}
            </Button>
          </div>

          {registrationMicrocopy ? (
            <div className="publicOrgEventReassurance">
              {registrationMicrocopy}
            </div>
          ) : !e.isSoldOut && !e.isRegistrationOpen ? (
            <div className="publicOrgEventReassurance">
              Les inscriptions sont clôturées pour cet événement
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}
