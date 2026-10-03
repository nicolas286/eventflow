import type { OrderPublicResponse } from "@contracts/orders-read";
import { readPublicOrder } from "@gateways/supabase/repositories/readPublicOrder";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Navigate,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { supabase } from "@gateways/supabase/supabaseClient";
import { EdgeRequestError, humanEdgeRequestMessage } from "@errors/edgeRequestError";
import { usePublicEventDetail } from "../../events/hooks/usePublicEventDetail";

import Container from "@ui/components/container/Container";
import Card, { CardBody } from "@ui/components/card/Card";
import Button from "@ui/components/button/Button";

import { PublicEventHeader } from "../components/PublicEventHeader";
import { formatMoney } from "@helpers/normalize";


import "@app/layouts/publicCheckoutBase.desktop.css";
import "./orderReturnPage.desktop.css";
import "./orderReturnPage.mobile.css";

type OrderPublic = OrderPublicResponse;
export type OrderStatus = OrderPublicResponse["status"];

function isFinalStatus(status: OrderStatus) {
  return (
    status === "paid" ||
    status === "partially_paid" ||
    status === "failed" ||
    status === "canceled" ||
    status === "expired" ||
    status === "refunded"
  );
}

function isSuccessStatus(status: OrderStatus) {
  return status === "paid" || status === "partially_paid";
}

function isFailureStatus(status: OrderStatus) {
  return (
    status === "failed" ||
    status === "canceled" ||
    status === "expired" ||
    status === "refunded"
  );
}

/**
 * ✅ Page "Commande" permanente.
 * - Accessible via lien mail (orderId + token)
 * - Le mode ?return=1 active un polling agressif (retour PSP)
 * - On n'auto-redirect plus : le récap est toujours visible
 */
export function OrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();

  const [search] = useSearchParams();

  /* ---------------- Query params ---------------- */

  const isReturn = search.get("return") === "1";
  const bookingToken =
    search.get("token") ?? search.get("bookingToken") ?? null;

  const orgSlugFromQuery = search.get("org") ?? search.get("orgSlug") ?? null;
  const eventSlugFromQuery =
    search.get("event") ?? search.get("eventSlug") ?? null;

  /* ---------------- State ---------------- */

  const [order, setOrder] = useState<OrderPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const copyFeedbackTimeoutRef = useRef<number | null>(null);
  const retryAtRef = useRef(0);
  const requestInFlightRef = useRef(false);

  const orgSlug = useMemo(
    () => order?.orgSlug ?? orgSlugFromQuery ?? null,
    [order?.orgSlug, orgSlugFromQuery],
  );

  const eventSlug = useMemo(
    () => order?.eventSlug ?? eventSlugFromQuery ?? null,
    [order?.eventSlug, eventSlugFromQuery],
  );

  const { loading: eventLoading, data: eventData } = usePublicEventDetail({
    supabase,
    orgSlug,
    eventSlug,
  });

  /* ---------------- Fetch helpers ---------------- */

  const stopPolling = useCallback(() => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  }, []);

  const handleFetchError = useCallback((cause: unknown) => {
    if (cause instanceof EdgeRequestError) {
      retryAtRef.current = Date.now() + cause.retryAfterSeconds * 1000;
      setError(humanEdgeRequestMessage(cause));
    } else {
      setError("Impossible de charger la commande.");
    }
  }, []);

  const loadOnce = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!orderId || !bookingToken) return;
      if (Date.now() < retryAtRef.current || requestInFlightRef.current) return;

      const silent = opts?.silent ?? false;

      let cancelled = false;
      const cancel = () => {
        cancelled = true;
      };

      try {
        requestInFlightRef.current = true;
        if (!silent) setIsRefreshing(true);

        const o = await readPublicOrder(orderId, bookingToken);
        if (cancelled) return;

        setOrder(o);
        setError(null);
        setLoading(false);

        // si c'est final, aucun intérêt de poll
        if (isFinalStatus(o.status)) stopPolling();
      } catch (cause) {
        if (cancelled) return;

        setLoading(false);
        handleFetchError(cause);
      } finally {
        requestInFlightRef.current = false;
        if (!silent) setIsRefreshing(false);
      }

      return cancel;
    },
    [orderId, bookingToken, stopPolling, handleFetchError],
  );

  /* ---------------- Initial load + polling retour PSP ---------------- */

  useEffect(() => {
    if (!orderId || !bookingToken) return;

    let cancelled = false;

    function safeSetOrder(o: OrderPublic) {
      if (cancelled) return;
      setOrder(o);
    }

    async function firstLoad() {
      if (!orderId || !bookingToken) return;
      try {
        requestInFlightRef.current = true;
        const o = await readPublicOrder(orderId, bookingToken);
        if (cancelled) return;
        safeSetOrder(o);
        setError(null);
        setLoading(false);

        if (isFinalStatus(o.status)) stopPolling();
      } catch (cause) {
        if (cancelled) return;
        handleFetchError(cause);
        setLoading(false);
      } finally {
        requestInFlightRef.current = false;
      }
    }

    async function poll() {
      if (!orderId || !bookingToken) return;
      if (Date.now() < retryAtRef.current || requestInFlightRef.current) return;
      try {
        requestInFlightRef.current = true;
        const o = await readPublicOrder(orderId, bookingToken);
        if (cancelled) return;
        safeSetOrder(o);
        setError(null);
        if (isFinalStatus(o.status)) stopPolling();
      } catch (cause) {
        if (!cancelled && cause instanceof EdgeRequestError) handleFetchError(cause);
        // tolère (réseau / edge)
      } finally {
        requestInFlightRef.current = false;
      }
    }

    firstLoad();

    // mode retour PSP : poll agressif, sinon on ne poll pas automatiquement
    if (isReturn) {
      intervalRef.current = window.setInterval(poll, 1500);
      timeoutRef.current = window.setTimeout(() => stopPolling(), 30_000);
    } else {
      stopPolling();
    }

    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [orderId, bookingToken, isReturn, stopPolling, handleFetchError]);

  useEffect(
    () => () => {
      if (copyFeedbackTimeoutRef.current) {
        window.clearTimeout(copyFeedbackTimeoutRef.current);
      }
    },
    [],
  );

  async function copyTransferValue(label: string, value: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!copied) throw new Error("COPY_FAILED");
      }

      setCopyFeedback(`${label} copié dans le presse-papier.`);
    } catch {
      setCopyFeedback(`Impossible de copier ${label.toLowerCase()}.`);
    }

    if (copyFeedbackTimeoutRef.current) {
      window.clearTimeout(copyFeedbackTimeoutRef.current);
    }
    copyFeedbackTimeoutRef.current = window.setTimeout(
      () => setCopyFeedback(null),
      3500,
    );
  }

  /* ---------------- Derived UI states ---------------- */

  const statusPill = useMemo(() => {
    if (!order) return null;

    if (
      order.status === "awaiting_payment" &&
      order.paymentMethod === "bank_transfer"
    ) {
      return { kind: "info" as const, label: "En attente du virement" };
    }

    if (isReturn && !isFinalStatus(order.status)) {
      return { kind: "loading" as const, label: "Validation du paiement…" };
    }

    if (isSuccessStatus(order.status)) {
      return {
        kind: "success" as const,
        label:
          order.status === "paid" && (order.totalCents ?? 0) === 0
            ? "Inscription confirmée"
            : order.status === "paid"
              ? "Paiement confirmé"
              : "Acompte reçu",
      };
    }

    if (order.status === "refunded") {
      return { kind: "warn" as const, label: "Commande remboursée" };
    }

    if (isFailureStatus(order.status)) {
      return { kind: "warn" as const, label: "Paiement non abouti" };
    }

    return { kind: "info" as const, label: "Commande en cours" };
  }, [order, isReturn]);

  const subtitle = useMemo(() => {
    if (!order) return null;

    if (isSuccessStatus(order.status)) {
      return order.status === "paid" && (order.totalCents ?? 0) === 0
        ? "Votre inscription est bien enregistrée."
        : order.status === "paid"
          ? "Votre commande est bien enregistrée."
          : "Votre acompte a bien été reçu.";
    }

    if (order.status === "refunded") {
      return "Cette commande a été intégralement remboursée. Les billets associés ne sont plus valables.";
    }

    if (isFailureStatus(order.status)) {
      return `Statut : ${order.status}`;
    }

    if (
      order.status === "awaiting_payment" &&
      order.paymentMethod === "bank_transfer"
    ) {
      return "Votre réservation est enregistrée. Elle sera confirmée dès réception du virement.";
    }

    return `Statut : ${order.status}`;
  }, [order]);

  /* ---------------- Guards ---------------- */

  if (!orderId) return <Navigate to="/" replace />;

  if (!bookingToken) {
    return (
      <div className="publicPage">
        <Container>
          <div className="orderReturnCenter">
            <Card className="orderReturnCard">
              <CardBody>
                <h2 className="orderReturnTitle">Lien invalide</h2>
                <p className="orderReturnSubtitle">
                  Il manque le jeton de sécurité pour retrouver la commande.
                </p>
              </CardBody>
            </Card>
          </div>
        </Container>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="publicPage">
        <Container>
          <div className="orderReturnCenter">
            <div className="orderReturnLoading">
              <span className="orderReturnSpinner" aria-hidden="true" />
              <div>
                <div className="orderReturnLoadingTitle">Chargement…</div>
                <div className="orderReturnLoadingSub">
                  Récupération de votre commande
                </div>
              </div>
            </div>
          </div>
        </Container>
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="publicPage">
        <Container>
          <div className="orderReturnCenter">
            <Card className="orderReturnCard">
              <CardBody>
                <h2 className="orderReturnTitle">Erreur</h2>
                <p className="orderReturnSubtitle">{error}</p>
                <div
                  className="orderReturnFooter"
                  style={{ justifyContent: "center" }}
                >
                  <Button onClick={() => loadOnce()}>Réessayer</Button>
                </div>
              </CardBody>
            </Card>
          </div>
        </Container>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="publicPage">
        <Container>
          <div className="orderReturnCenter">
            <Card className="orderReturnCard">
              <CardBody>
                <h2 className="orderReturnTitle">Commande introuvable</h2>
                <div
                  className="orderReturnFooter"
                  style={{ justifyContent: "center" }}
                >
                  <Button onClick={() => loadOnce()}>Rafraîchir</Button>
                </div>
              </CardBody>
            </Card>
          </div>
        </Container>
      </div>
    );
  }

  const orgForHeader = eventData?.org;
  const eventForHeader = eventData?.event ?? null;
  const organizationEventsHref = orgSlug
    ? `/o/${encodeURIComponent(orgSlug)}`
    : "/";
  const isBankTransferPending =
    order.paymentMethod === "bank_transfer" &&
    order.status === "awaiting_payment";
  const bankTransfer = order.bankTransfer;
  const isFreeOrder = (order.totalCents ?? 0) === 0;
  const confirmationTitle = isSuccessStatus(order.status)
    ? isFreeOrder
      ? "Votre inscription est confirmée"
      : "Merci, tout est confirmé"
    : isBankTransferPending
      ? "Votre réservation est enregistrée"
      : "Suivi de votre commande";

  const pillClass =
    statusPill?.kind === "success"
      ? "orderReturnStatusPill orderReturnSuccess"
      : statusPill?.kind === "warn"
        ? "orderReturnStatusPill orderReturnWarn"
        : statusPill?.kind === "loading"
          ? "orderReturnStatusPill"
          : "orderReturnStatusPill";

  return (
    <div className="publicPage">
      <Container>
        {orgSlug && eventForHeader ? (
          <PublicEventHeader
            orgSlug={orgSlug}
            org={orgForHeader}
            event={eventForHeader}
            compact
          />
        ) : null}

        <div className="orderReturnShell">
          <main className="orderReturnMain">
            <Card className="orderReturnCard orderReturnHeroCard">
              <CardBody>
                <div className="orderReturnHero">
                  <div
                    className={`orderReturnHeroIcon ${isSuccessStatus(order.status) ? "isSuccess" : isFailureStatus(order.status) ? "isWarning" : "isPending"}`}
                    aria-hidden="true"
                  >
                    {isSuccessStatus(order.status)
                      ? "✓"
                      : isFailureStatus(order.status)
                        ? "!"
                        : "…"}
                  </div>
                  <div className="orderReturnHeroCopy">
                    {statusPill ? (
                      <div className={pillClass}>{statusPill.label}</div>
                    ) : null}
                    <h1 className="orderReturnTitle">{confirmationTitle}</h1>
                    <p className="orderReturnSubtitle">{subtitle}</p>
                  </div>
                </div>

                <div className="orderReturnNotice">
                  <span className="orderReturnNoticeIcon" aria-hidden="true">
                    ↗
                  </span>
                  <div>
                    <strong>
                      {isBankTransferPending
                        ? "Consultez les instructions de paiement ci-dessous"
                        : "Gardez un œil sur votre boîte e-mail"}
                    </strong>
                    <p>
                      {isBankTransferPending
                        ? "Les coordonnées de virement vous ont également été envoyées par e-mail."
                        : "Votre confirmation et vos billets vous seront envoyés dans quelques instants."}
                    </p>
                  </div>
                </div>

                {isReturn && !isFinalStatus(order.status) ? (
                  <div className="orderReturnLoading orderReturnPolling">
                    <span className="orderReturnSpinner" aria-hidden="true" />
                    <div className="orderReturnLoadingSub">
                      Validation en cours. Cela peut prendre quelques secondes.
                    </div>
                  </div>
                ) : null}

                {orgSlug && eventSlug && eventLoading ? (
                  <div className="orderReturnHint">
                    Chargement des informations de l’événement…
                  </div>
                ) : null}

                <div className="orderReturnFooter">
                  <Button
                    variant="primary"
                    onClick={() => navigate(organizationEventsHref)}
                  >
                    Voir les événements de l’organisation
                  </Button>
                  <Button
                    onClick={() => loadOnce({ silent: false })}
                    disabled={isRefreshing}
                    variant="secondary"
                  >
                    {isRefreshing ? "Actualisation…" : "Actualiser le statut"}
                  </Button>
                </div>

                {error ? (
                  <div className="orderReturnHint" role="status">
                    {error}
                  </div>
                ) : null}
              </CardBody>
            </Card>

            {isBankTransferPending && bankTransfer ? (
              <section
                className="orderReturnTransfer"
                aria-labelledby="transfer-title"
              >
                <div className="orderReturnSectionHeading">
                  <span>À faire maintenant</span>
                  <h2 id="transfer-title">Effectuer le virement</h2>
                  <p>
                    Utilisez exactement la communication ci-dessous afin que
                    votre paiement soit rapproché automatiquement.
                  </p>
                </div>
                <div className="orderReturnTransferGrid">
                  <div className="orderReturnTransferValue">
                    <span>Montant</span>
                    <strong>
                      {formatMoney(
                        bankTransfer.amountCents,
                        bankTransfer.currency,
                      )}
                    </strong>
                    <button
                      type="button"
                      className="orderReturnCopyButton"
                      onClick={() =>
                        void copyTransferValue(
                          "Montant",
                          formatMoney(
                            bankTransfer.amountCents,
                            bankTransfer.currency,
                          ),
                        )
                      }
                    >
                      Copier
                    </button>
                  </div>
                  <div>
                    <span>Bénéficiaire</span>
                    <strong>{bankTransfer.beneficiary}</strong>
                  </div>
                  <div className="orderReturnTransferValue">
                    <span>IBAN</span>
                    <strong>{bankTransfer.iban}</strong>
                    <button
                      type="button"
                      className="orderReturnCopyButton"
                      onClick={() =>
                        void copyTransferValue("IBAN", bankTransfer.iban)
                      }
                    >
                      Copier
                    </button>
                  </div>
                  <div className="orderReturnTransferCommunication orderReturnTransferValue">
                    <span>Communication</span>
                    <strong>{bankTransfer.communication}</strong>
                    <button
                      type="button"
                      className="orderReturnCopyButton"
                      onClick={() =>
                        void copyTransferValue(
                          "Communication",
                          bankTransfer.communication,
                        )
                      }
                    >
                      Copier
                    </button>
                  </div>
                </div>
                <div className="orderReturnCopyFeedback" aria-live="polite">
                  {copyFeedback}
                </div>
              </section>
            ) : null}

            {order.items?.length ? (
              <section className="orderReturnSection">
                <div className="orderReturnSectionTitle">Votre commande</div>
                <div className="orderReturnItems">
                  {order.items.map((item, index) => (
                    <div key={index} className="orderReturnItemRow">
                      <div className="orderReturnItemLeft">
                        <div className="orderReturnItemName">
                          {item.name ?? "Article"}
                        </div>
                        <div className="orderReturnItemQty">
                          Quantité : {item.quantity ?? 1}
                        </div>
                      </div>
                      <div className="orderReturnItemPrice">
                        {formatMoney(
                          item.totalCents ??
                            (item.unitPriceCents ?? 0) * (item.quantity ?? 1),
                          item.currency ?? order.currency,
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </main>

          <aside
            className="orderReturnSummary"
            aria-label="Résumé de la commande"
          >
            <Card className="orderReturnCard orderReturnSummaryCard">
              <CardBody>
                <div className="orderReturnSummaryHeader">
                  <span>Montant total</span>
                  <strong>
                    {formatMoney(order.totalCents ?? undefined, order.currency ?? undefined)}
                  </strong>
                </div>
                <div className="orderReturnSummaryStatus">
                  <span className={pillClass}>{statusPill?.label}</span>
                </div>
                <details className="orderReturnTechnical">
                  <summary>Informations de la commande</summary>
                  <dl>
                    <div>
                      <dt>Numéro</dt>
                      <dd>{order.id}</dd>
                    </div>
                    {order.buyerEmail ? (
                      <div>
                        <dt>E-mail</dt>
                        <dd>{order.buyerEmail}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Statut technique</dt>
                      <dd>{order.status}</dd>
                    </div>
                    {bankTransfer?.internalReference ? (
                      <div>
                        <dt>Référence Eventflow</dt>
                        <dd>{bankTransfer.internalReference}</dd>
                      </div>
                    ) : null}
                  </dl>
                </details>
                <p className="orderReturnSupport">
                  Une question ? Contactez directement l’organisateur de
                  l’événement.
                </p>
              </CardBody>
            </Card>
          </aside>
        </div>
      </Container>
    </div>
  );
}
