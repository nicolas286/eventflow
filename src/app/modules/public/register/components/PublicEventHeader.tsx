import { Link } from "react-router-dom";
import { formatDateTimeHuman, getDurationLabel } from "@helpers/dateTime";

import "@layouts/publicPages.desktop.css";
import "./PublicEventHeader.css";
import type {
  PublicEvent,
  PublicOrgProfileOverviewForEventPage,
} from "../../events/schemas/public.eventDetailBySlug.schema";
import {
  CalendarIcon,
  HourglassIcon,
  PinIcon,
} from "@shared/ui/components/icon/Icons";

type Props = {
  orgSlug: string;
  org?: PublicOrgProfileOverviewForEventPage;
  event: PublicEvent;
};

export function PublicEventHeader({ orgSlug, org, event }: Props) {
  const startText = event.startsAt ? formatDateTimeHuman(event.startsAt) : null;
  const durationText = getDurationLabel(event.startsAt, event.endsAt);
  const banner = event.bannerUrl;

  const googleMapsUrl = event.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`
    : null;

  return (
    <>
      {banner ? (
        <>
          <div
            className="publicBannerWrap"
            style={{ ["--banner-url" as string]: `url("${banner}")` }}
          >
            <div className="publicBannerClip">
              <div className="publicBanner" aria-label={event.title} />
            </div>

            {org?.logoUrl ? (
              <img
                src={org.logoUrl}
                alt={org.slug}
                className="publicBannerLogo"
              />
            ) : null}
          </div>

          <div className="publicBannerUnderSpace" />
        </>
      ) : null}

      <div className="publicHeaderRow">
        <div className="publicTitleBlock">
          <h1 className="publicTitle">{event.title}</h1>

          {org?.displayName ? (
            <div className="publicSubtitle" style={{ marginTop: 6 }}>
              Organisé par <strong>{org.displayName}</strong>
              {org.publicEmail ? (
                <>
                  {" — "}
                  <a href={`mailto:${org.publicEmail}`}>{org.publicEmail}</a>
                </>
              ) : null}
            </div>
          ) : null}

          {startText || event.location || durationText ? (
            <div className="publicMetaCard">
              {startText ? (
                <div className="publicMetaItem">
                  <CalendarIcon />
                  <span className="publicMetaLabel">Début</span>
                  <span className="publicMetaValue">{startText}</span>
                </div>
              ) : null}

              {event.location && googleMapsUrl ? (
                <a
                  href={googleMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="publicMetaItem publicMetaItemLink"
                  aria-label={`Ouvrir le lieu dans Google Maps : ${event.location}`}
                  title="Ouvrir dans Google Maps"
                >
                  <PinIcon />
                  <span className="publicMetaLabel">Lieu</span>
                  <span className="publicMetaValue">{event.location}</span>
                </a>
              ) : null}

              {durationText ? (
                <div className="publicMetaItem">
                  <HourglassIcon />
                  <span className="publicMetaLabel">Durée</span>
                  <span className="publicMetaValue">{durationText}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="publicActions">
          <Link to={`/o/${orgSlug}`}>← Retour</Link>
        </div>
      </div>
    </>
  );
}
