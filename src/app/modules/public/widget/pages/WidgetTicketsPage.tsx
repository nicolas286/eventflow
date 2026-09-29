import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { supabase } from "@gateways/supabase/supabaseClient";
import { usePublicEventDetail } from "../../events/hooks/usePublicEventDetail";
import { useWidgetTheme } from "../hooks/useWidgetTheme";
import { useLocation } from "react-router-dom";
import { useWidgetAutoResize } from "../hooks/useWidgetAutoResize";

import { Button } from "@shared/ui/components";
import { WidgetHeader } from "../components/WidgetHeader/WidgetHeader";

import {
  loadDraft,
  saveDraft,
  formatMoney,
} from "../../register/helpers/checkoutStore";

import {
  computeRemaining,
  computeTotalCents,
  computeNextQty,
  quantitiesToItems,
  resolveCurrency,
  sortBySortOrder,
  sumItemQuantities,
  resolveMaxQty,
} from "@helpers/logic";

import "./WidgetTicketsPage.css";
import { WidgetFooter } from "../components/WidgetFooter/WidgetFooter";
import { WidgetRoot } from "../components/WidgetRoot/WidgetRoot";
import { WidgetGrid } from "../components/WidgetGrid/WidgetGrid";
import { WidgetTicketCard } from "../components/WidgetTicketCard/WidgetTicketCard";

export function WidgetTicketsPage() {
  const navigate = useNavigate();
  const theme = useWidgetTheme();
  useWidgetAutoResize();

  const MAX_TICKETS = 4;

  const { orgSlug, eventSlug } = useParams<{
    orgSlug: string;
    eventSlug: string;
  }>();

  const { loading, error, data } = usePublicEventDetail({
    supabase,
    orgSlug,
    eventSlug,
  });

  const [tick, setTick] = useState(0);
  const { search } = useLocation();

  const draft = useMemo(() => {
    if (!orgSlug || !eventSlug) return null;
    void tick;
    return loadDraft(orgSlug, eventSlug);
  }, [orgSlug, eventSlug, tick]);

  if (loading || !orgSlug || !eventSlug) {
    return <div className="widgetRoot">Chargement…</div>;
  }

  if (error) {
    return <div className="widgetRoot">Erreur : {error}</div>;
  }

  if (!data?.event) {
    return <div className="widgetRoot">Événement introuvable</div>;
  }

  const { org, event, products } = data;

  const isEventSoldOut = event.isSoldOut === true;
  const isRegistrationClosed = event.isRegistrationOpen === false;
  const isEventClosed = isEventSoldOut || isRegistrationClosed;
  const paidSalesAvailable = org.paidSalesAvailable === true;

  const quantities = isEventClosed ? {} : (draft?.quantities ?? {});
  const sortedProducts = sortBySortOrder(products);
  const visibleProducts = sortedProducts.slice(0, MAX_TICKETS);
  const items = quantitiesToItems(quantities);
  const totalTickets = sumItemQuantities(items);
  const totalCents = computeTotalCents(items, sortedProducts);
  const currency = resolveCurrency(sortedProducts);

  function updateQty(productId: string, nextQty: number) {
    if (!draft || isEventClosed) return;

    const p = sortedProducts.find((x) => x.id === productId);
    if (!p) return;
    const currentQty = Number(draft.quantities[p.id] ?? 0) || 0;
    if (p.priceCents > 0 && !paidSalesAvailable && nextQty >= currentQty) return;

    const remaining = computeRemaining(p);
    const q = computeNextQty(nextQty, remaining);

    const next = {
      ...draft,
      quantities: { ...draft.quantities, [productId]: q },
      attendees: [],
      acceptedTerms: false,
    };

    saveDraft(next);
    setTick((x) => x + 1);
  }

  function goNext() {
    if (isEventClosed || (totalCents > 0 && !paidSalesAvailable)) return;
    navigate(`/widget/o/${orgSlug}/e/${eventSlug}/participants${search}`);
  }

  function goBack() {
    navigate(`/widget/o/${orgSlug}${search}`);
  }

  const continueLabel = isEventSoldOut
    ? "Complet"
    : isRegistrationClosed
      ? "Clôturé"
      : "Continuer";

  return (
    <WidgetRoot theme={theme}>
      <WidgetHeader
        left={<Button className="widgetButton" variant="ghost" label="← Retour" onClick={goBack} />}
        title={event.title}
      />

      {isEventSoldOut ? (
        <div className="widgetEmptyState">Cet événement est complet.</div>
      ) : isRegistrationClosed ? (
        <div className="widgetEmptyState">Les inscriptions sont clôturées.</div>
      ) : (
        <WidgetGrid>
          {visibleProducts.map((p) => {
            const qty = Number(quantities[p.id] ?? 0) || 0;
            const remaining = computeRemaining(p);
            const soldOut = remaining === 0 && remaining != null;
            const paidUnavailable = p.priceCents > 0 && !paidSalesAvailable;
            const maxQty = resolveMaxQty(remaining);
            const moneyCurrency = p.currency ?? currency;

            return (
              <WidgetTicketCard
                key={p.id}
                product={p}
                soldOut={soldOut}
                unavailable={paidUnavailable}
                currency={moneyCurrency}
                qty={qty}
                maxQty={maxQty}
                updateQty={updateQty}
              />
            );
          })}
        </WidgetGrid>
      )}

      {!isEventClosed && sortedProducts.length > MAX_TICKETS && (
        <div className="widgetMoreEvents">
          <Button
            className="widgetButton"
            variant="secondary"
            label="Voir tous les billets"
            onClick={() =>
              window.open(`/o/${orgSlug}/e/${eventSlug}/billets`, "_blank")
            }
          />
        </div>
      )}

      <div className="widgetRecap">
        <div>
          {totalTickets} billet(s) · {formatMoney(totalCents, currency)}
        </div>

        <Button
          className="widgetButton"
          label={continueLabel}
          onClick={goNext}
          disabled={isEventClosed || totalTickets <= 0 || (totalCents > 0 && !paidSalesAvailable)}
        />
      </div>

      <WidgetFooter />
    </WidgetRoot>
  );
}
