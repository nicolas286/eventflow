import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@gateways/supabase/supabaseClient";
import { usePublicEventDetail } from "../../events/hooks/usePublicEventDetail";

import Container from "@ui/components/container/Container";
import Card, { CardBody, CardHeader } from "@ui/components/card/Card";
import { PublicStickyCheckoutBar } from "../components/PublicStickyCheckoutBar/PublicStickyCheckoutBar";
import Button from "@ui/components/button/Button";
import Badge from "@ui/components/badge/Badge";
import { Seo } from "@shared/ui/components/seo/Seo";

import { PublicEventHeader } from "../components/PublicEventHeader";
import { PublicCheckoutStepper } from "../components/PublicCheckoutStepper/PublicCheckoutStepper";
import { loadDraft, saveDraft, formatMoney } from "../helpers/checkoutStore";
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

import "@app/layouts/publicCheckoutBase.desktop.css";
import "./EventTicketsPage.desktop.css";
import "./EventTicketsPage.mobile.css";
import MarkdownText from "@shared/ui/components/markdowntext/MarkdownText";

export function EventTicketsPage() {
  const navigate = useNavigate();
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
  const [descExpanded, setDescExpanded] = useState(false);

  const draft = useMemo(() => {
    if (!orgSlug || !eventSlug) return null;
    void tick;
    return loadDraft(orgSlug, eventSlug);
  }, [orgSlug, eventSlug, tick]);

  if (loading || !orgSlug || !eventSlug) {
    return (
      <div className="publicPage">
        <Container>Chargement…</Container>
      </div>
    );
  }

  if (error) {
    return (
      <div className="publicPage">
        <Container>Erreur : {error}</Container>
      </div>
    );
  }

  if (!data?.event) {
    return (
      <div className="publicPage">
        <Container>Événement introuvable.</Container>
      </div>
    );
  }

  const { org, event, products } = data;

  const isEventSoldOut = event.isSoldOut === true;
  const isRegistrationClosed = event.isRegistrationOpen === false;
  const isEventClosed = isEventSoldOut || isRegistrationClosed;
  const paidSalesAvailable = org.paidSalesAvailable === true;

  const quantities = draft?.quantities ?? {};
  const sortedProducts = sortBySortOrder(products);
  const items = quantitiesToItems(quantities);
  const totalTickets = sumItemQuantities(items);
  const totalCents = computeTotalCents(items, sortedProducts);
  const currency = resolveCurrency(sortedProducts);

  function updateQty(productId: string, nextQty: number) {
    if (!draft || isEventClosed) return;

    const p = sortedProducts.find((x) => x.id === productId);
    if (!p) return;
    const currentQty = Number(draft.quantities[p.id] ?? 0) || 0;
    if (p.priceCents > 0 && !paidSalesAvailable && nextQty >= currentQty)
      return;

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
    navigate(`/o/${orgSlug}/e/${eventSlug}/participants`);
  }

  const baseUrl = import.meta.env.VITE_PUBLIC_BASE_URL;
  const url = `${baseUrl}/o/${orgSlug}/e/${eventSlug}/billets`;

  const title = event
    ? `${event.title} – ${org?.displayName ?? "Eventflow, la billetterie sans commission"}`
    : "Événement";
  const desc = event?.description?.slice(0, 160) ?? "Réserve tes billets.";
  const ogImage = event?.bannerUrl;

  const stickyCtaLabel = isEventSoldOut
    ? "Complet"
    : isRegistrationClosed
      ? "Inscriptions clôturées"
      : "Continuer →";

  return (
    <>
      <Seo
        title={title}
        description={desc}
        canonicalUrl={url}
        ogTitle={title}
        ogDescription={desc}
        ogUrl={url}
        ogImage={ogImage}
      />

      <div className="publicPage">
        <Container>
          <div className="publicSurface">
            <PublicEventHeader orgSlug={orgSlug} org={org} event={event} />

            <PublicCheckoutStepper
              currentStep={1}
              orgSlug={orgSlug}
              eventSlug={eventSlug}
            />

            {event.description ? (
              <div className="publicEventIntro">
                <MarkdownText
                  markdown={event.description}
                  className={`publicEventIntroText ${descExpanded ? "isExpanded" : ""}`}
                />

                {event.description.length > 240 ? (
                  <button
                    type="button"
                    className="publicEventIntroToggle"
                    onClick={() => setDescExpanded((v) => !v)}
                  >
                    {descExpanded ? "Réduire" : "Lire plus"}
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="publicDivider" />

            <div className="publicSectionHeading">
              <div>
                <div className="publicEyebrow">Billetterie</div>
                <h2 className="publicSectionTitle">Choisissez vos billets</h2>
              </div>
              <p>Sélectionnez la quantité souhaitée pour chaque tarif.</p>
            </div>

            {!paidSalesAvailable &&
            sortedProducts.some((p) => p.priceCents > 0) ? (
              <div className="publicEmpty">
                Les paiements sont temporairement indisponibles pour cet
                organisateur. Les billets gratuits restent réservables.
              </div>
            ) : null}

            {isEventSoldOut ? (
              <div className="publicEmpty">Cet événement est complet.</div>
            ) : isRegistrationClosed ? (
              <div className="publicEmpty">
                Les inscriptions sont clôturées pour cet événement.
              </div>
            ) : sortedProducts.length === 0 ? (
              <div className="publicEmpty">
                Aucun billet disponible pour le moment.
              </div>
            ) : (
              <div className="publicGutter">
                <div className="publicList">
                  {sortedProducts.map((p) => {
                    const qty = Number(quantities[p.id] ?? 0) || 0;

                    const remaining = computeRemaining(p);
                    const paidUnavailable =
                      p.priceCents > 0 && !paidSalesAvailable;
                    const soldOut = remaining === 0 && remaining != null;
                    const maxQty = resolveMaxQty(remaining);

                    const badgeTone =
                      soldOut || paidUnavailable ? "danger" : "success";
                    const badgeLabel = soldOut
                      ? "Épuisé"
                      : paidUnavailable
                        ? "Paiement indisponible"
                        : "Disponible";

                    const createsAtt = p.createsAttendees === true;
                    const perUnit = p.attendeesPerUnit ?? 0;
                    const createdCount = createsAtt ? qty * perUnit : 0;

                    const moneyCurrency = p.currency ?? currency;

                    return (
                      <Card
                        key={p.id}
                        className={`publicTicketCard ${soldOut ? "isSoldOut" : ""} ${qty > 0 ? "isSelected" : ""}`}
                      >
                        <CardHeader
                          title={
                            <div className="publicCardTitle">{p.name}</div>
                          }
                          subtitle={
                            <div className="publicSubtitle">
                              {formatMoney(p.priceCents, moneyCurrency)}
                            </div>
                          }
                          right={
                            soldOut || paidUnavailable ? (
                              <Badge tone={badgeTone} label={badgeLabel} />
                            ) : qty > 0 ? (
                              <Badge tone="success" label="Sélectionné" />
                            ) : null
                          }
                        />

                        <CardBody className="publicTicketBody">
                          <div className="publicTicketLayout">
                            <div className="publicTicketLeft">
                              {p.description ? (
                                <div
                                  className="publicProse publicTicketDesc"
                                  style={{ whiteSpace: "pre-wrap" }}
                                >
                                  {p.description}
                                </div>
                              ) : null}

                              <div className="publicMetaRow">
                                {createsAtt ? (
                                  <span>
                                    Participants : {perUnit} / billet
                                    {qty > 0
                                      ? ` · ${createdCount} participant(s) à renseigner`
                                      : ""}
                                  </span>
                                ) : (
                                  <span>
                                    Ce billet ne demande pas de formulaire
                                    participant
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="publicTicketRight">
                              <div className="publicQtyBlock">
                                <Button
                                  variant="primary"
                                  label="−"
                                  onClick={() => updateQty(p.id, qty - 1)}
                                  disabled={
                                    qty <= 0 || soldOut || isEventClosed
                                  }
                                  className="publicQtyBtn"
                                />

                                <input
                                  type="number"
                                  min={0}
                                  max={paidUnavailable ? qty : maxQty}
                                  value={qty}
                                  onChange={(e) =>
                                    updateQty(p.id, Number(e.target.value))
                                  }
                                  className="publicQtyInput"
                                  disabled={soldOut || isEventClosed}
                                />

                                <Button
                                  variant="primary"
                                  label="+"
                                  onClick={() => updateQty(p.id, qty + 1)}
                                  disabled={
                                    soldOut ||
                                    isEventClosed ||
                                    paidUnavailable ||
                                    qty >= maxQty
                                  }
                                  className="publicQtyBtn"
                                />
                              </div>

                              {qty > 0 ? (
                                <div className="publicTicketTotal">
                                  Sous-total&nbsp;:{" "}
                                  {formatMoney(
                                    qty * p.priceCents,
                                    moneyCurrency,
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </Container>

        <PublicStickyCheckoutBar
          amountCents={totalCents}
          currency={currency}
          primaryText={`${totalTickets} billet(s)`}
          onClick={goNext}
          disabled={
            isEventClosed ||
            totalTickets <= 0 ||
            (totalCents > 0 && !paidSalesAvailable)
          }
          ctaLabel={stickyCtaLabel}
        />
      </div>
    </>
  );
}
