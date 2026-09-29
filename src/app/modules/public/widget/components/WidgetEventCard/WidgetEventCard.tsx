import type { PublicEventOverview } from "@app/modules/public/organization/schemas/public.orgEventsOverview.schema";
import { usePublicEventDetail } from "@app/modules/public/events/hooks/usePublicEventDetail";
import { supabase } from "@gateways/supabase/supabaseClient";
import { Button } from "@shared/ui/components";
import "./WidgetEventCard.css";

type Props = {
  event: PublicEventOverview;
  orgSlug: string;
  onClick: () => void;

  ctaText?: string;
  displayRemaining?: boolean;
};

export function WidgetEventCard({
  event,
  orgSlug,
  onClick,
  ctaText,
  displayRemaining = false,
}: Props) {
  const { data } = usePublicEventDetail({
    supabase,
    orgSlug,
    eventSlug: event.slug,
  });

  const remainingSeats = (() => {
    if (!displayRemaining || !data?.products?.length) return null;

    const productsWithStock = data.products.filter(
      (product) => product.stockQty !== null && product.stockQty !== undefined,
    );

    if (productsWithStock.length === 0) return null;

    return productsWithStock.reduce((total, product) => {
      const usedQty = (product.soldQty ?? 0) + (product.reservedQty ?? 0);
      const remainingQty = Math.max((product.stockQty ?? 0) - usedQty, 0);
      const attendeesPerUnit = product.attendeesPerUnit ?? 1;

      return total + remainingQty * attendeesPerUnit;
    }, 0);
  })();

  const isSoldOut = event.isSoldOut;
  const isClosed = event.isRegistrationOpen === false;

  const noSeatsLeft =
    displayRemaining && remainingSeats !== null && remainingSeats <= 0;

  const isDisabled = isSoldOut || isClosed || noSeatsLeft;

  const label = isSoldOut
    ? "Complet"
    : isClosed
      ? "Clôturé"
      : noSeatsLeft
        ? "Complet"
        : (ctaText ?? "Billets");

  return (
    <div
      className={`widgetEventCard ${isDisabled ? "isDisabled" : ""}`}
      onClick={() => {
        if (!isDisabled) onClick();
      }}
    >
      {event.bannerUrl ? (
        <div
          className="widgetEventBanner"
          style={{ backgroundImage: `url("${event.bannerUrl}")` }}
          aria-hidden="true"
        />
      ) : null}

      <div className="widgetEventContent">
        <div className="widgetEventTitle">{event.title}</div>

        {event.startsAt && (
          <div className="widgetEventDate">
            {new Date(event.startsAt).toLocaleString("fr-BE", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </div>
        )}

        {displayRemaining && remainingSeats !== null && (
          <div
            className={`widgetEventRemaining ${
              remainingSeats <= 5 ? "isLow" : ""
            }`}
          >
            {remainingSeats > 0
              ? `${remainingSeats} place${remainingSeats > 1 ? "s" : ""} restante${
                  remainingSeats > 1 ? "s" : ""
                }`
              : "Complet"}
          </div>
        )}

        {isSoldOut ? (
          <div className="widgetEventStatus">Complet</div>
        ) : isClosed ? (
          <div className="widgetEventStatus">Inscriptions clôturées</div>
        ) : null}

        <Button
          className="widgetButton"
          label={label}
          disabled={isDisabled}
          onClick={(e) => {
            e.stopPropagation();
            if (!isDisabled) onClick();
          }}
        />
      </div>
    </div>
  );
}
