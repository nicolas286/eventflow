import { orderPublicSchema } from "@contracts/orders-read";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";

import { supabase } from "@gateways/supabase/supabaseClient";
import { usePublicEventDetail } from "../../events/hooks/usePublicEventDetail";

import Container from "@ui/components/container/Container";
import Card, { CardBody } from "@ui/components/card/Card";
import Button from "@ui/components/button/Button";

import { PublicEventHeader } from "../components/PublicEventHeader";
import { formatMoney } from "@helpers/normalize";

import "@app/layouts/publicCheckoutBase.desktop.css";
import "./orderReturnPage.desktop.css";
import "./orderReturnPage.mobile.css";

export type OrderStatus =
  | "open"
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "canceled"
  | "expired"
  | "awaiting_payment"
  | "partially_paid";

export type OrderItemPublic = {
  name?: string;
  quantity?: number;
  unitPriceCents?: number;
  totalCents?: number;
  currency?: string;
};

export type OrderPublic = {
  id: string;
  status: OrderStatus;
  totalCents?: number;
  currency?: string;

  orgSlug?: string;
  eventSlug?: string;

  buyerEmail?: string;
  items?: OrderItemPublic[];
};

function isFinalStatus(status: OrderStatus) {
  return (
    status === "paid" ||
    status === "partially_paid" ||
    status === "failed" ||
    status === "canceled" ||
    status === "expired"
  );
}

function isSuccessStatus(status: OrderStatus) {
  return status === "paid" || status === "partially_paid";
}

function isFailureStatus(status: OrderStatus) {
  return status === "failed" || status === "canceled" || status === "expired";
}

async function fetchOrder(orderId: string, token: string): Promise<OrderPublic> {
  if (!orderId) throw new Error("order_fetch_failed");

  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/orders/${encodeURIComponent(
      orderId,
    )}?token=${encodeURIComponent(token)}`,
    {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
    },
  );

  if (!res.ok) throw new Error("order_fetch_failed");
  const parsed = orderPublicSchema.parse(await res.json());
  const j = { ...parsed, totalCents: parsed.totalCents ?? undefined, currency: parsed.currency ?? undefined };

  return {
    id: j.id,
    status: j.status,

    totalCents: j.totalCents,
    currency: j.currency,



  };
}

/**
 * ✅ Page "Commande" permanente.
 * - Accessible via lien mail (orderId + token)
 * - Le mode ?return=1 active un polling agressif (retour PSP)
 * - On n'auto-redirect plus : le récap est toujours visible
 */
export function OrderPage() {
  const { orderId } = useParams<{ orderId: string }>();
  
  const [search] = useSearchParams();

  /* ---------------- Query params ---------------- */

  const isReturn = search.get("return") === "1";
  const bookingToken = search.get("token") ?? search.get("bookingToken") ?? null;

  const orgSlugFromQuery = search.get("org") ?? search.get("orgSlug") ?? null;
  const eventSlugFromQuery = search.get("event") ?? search.get("eventSlug") ?? null;

  /* ---------------- State ---------------- */

  const [order, setOrder] = useState<OrderPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const intervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

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

  const loadOnce = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!orderId || !bookingToken) return;

      const silent = opts?.silent ?? false;

      let cancelled = false;
      const cancel = () => {
        cancelled = true;
      };

      try {
        if (!silent) setIsRefreshing(true);

        const o = await fetchOrder(orderId, bookingToken);
        if (cancelled) return;

        setOrder(o);
        setError(null);
        setLoading(false);

        // si c'est final, aucun intérêt de poll
        if (isFinalStatus(o.status)) stopPolling();
      } catch {
        if (cancelled) return;

        setLoading(false);
        setError("Impossible de charger la commande.");
      } finally {
        if (!silent) setIsRefreshing(false);
      }

      return cancel;
    },
    [orderId, bookingToken, stopPolling],
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
        
        const o = await fetchOrder(orderId, bookingToken);
        if (cancelled) return;
        safeSetOrder(o);
        setError(null);
        setLoading(false);

        if (isFinalStatus(o.status)) stopPolling();
      } catch {
        if (cancelled) return;
        setError("Impossible de charger la commande.");
        setLoading(false);
      }
    }

    async function poll() {
      if (!orderId || !bookingToken) return;
      try {
        const o = await fetchOrder(orderId, bookingToken);
        if (cancelled) return;
        safeSetOrder(o);
        if (isFinalStatus(o.status)) stopPolling();
      } catch {
        // tolère (réseau / edge)
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
  }, [orderId, bookingToken, isReturn, stopPolling]);

  /* ---------------- Derived UI states ---------------- */

  const statusPill = useMemo(() => {
    if (!order) return null;

    if (isReturn && !isFinalStatus(order.status)) {
      return { kind: "loading" as const, label: "Validation du paiement…" };
    }

    if (isSuccessStatus(order.status)) {
      return {
        kind: "success" as const,
        label: order.status === "paid" ? "Paiement confirmé ✅" : "Acompte reçu ✅",
      };
    }

    if (isFailureStatus(order.status)) {
      return { kind: "warn" as const, label: "Paiement non abouti" };
    }

    return { kind: "info" as const, label: "Commande en cours" };
  }, [order, isReturn]);

  const subtitle = useMemo(() => {
    if (!order) return null;

    if (isSuccessStatus(order.status)) {
      return order.status === "paid"
        ? "Votre commande est bien enregistrée."
        : "Votre acompte a bien été reçu.";
    }

    if (isFailureStatus(order.status)) {
      return `Statut : ${order.status}`;
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
                <div className="orderReturnLoadingSub">Récupération de votre commande</div>
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
                <div className="orderReturnFooter" style={{ justifyContent: "center" }}>
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
                <div className="orderReturnFooter" style={{ justifyContent: "center" }}>
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
          <PublicEventHeader orgSlug={orgSlug} org={orgForHeader} event={eventForHeader} />
        ) : null}

        <div className="orderReturnCenter">
          <Card className="orderReturnCard">
            <CardBody>
              {statusPill ? <div className={pillClass}>{statusPill.label}</div> : null}

              <h2 className="orderReturnTitle">
                {isSuccessStatus(order.status) ? "Merci !" : "Récapitulatif de la commande"}
              </h2>

              <p className="orderReturnSubtitle">{subtitle}</p>
              <p className="orderReturnSubtitle">Vous recevrez un mail de confirmation dans quelques instants.</p>
              <p className="orderReturnSubtitle">Pour toutes questions, contactez l'organisateur de l'événement.</p>

              {isReturn && !isFinalStatus(order.status) ? (
                <div className="orderReturnLoading" style={{ marginTop: 10 }}>
                  <span className="orderReturnSpinner" aria-hidden="true" />
                  <div>
                    <div className="orderReturnLoadingSub">
                      Cela peut prendre quelques secondes. Statut : <strong>{order.status}</strong>
                    </div>
                  </div>
                </div>
              ) : null}

              {orgSlug && eventSlug && eventLoading ? (
                <div className="orderReturnHint">Chargement des infos de l’événement…</div>
              ) : null}

              {/* --------- Détails commande --------- */}
              <div className="orderReturnSection">
                <div className="orderReturnSectionTitle">Détail de la commande</div>

                <div className="orderReturnMeta">
                  <div>
                    <span className="orderReturnLabel">Commande :</span>
                    <span className="orderReturnStrong">{order.id}</span>
                  </div>

                  {order.buyerEmail ? (
                    <div>
                      <span className="orderReturnLabel">Email :</span>
                      <span className="orderReturnStrong">{order.buyerEmail}</span>
                    </div>
                  ) : null}

                  <div>
                    <span className="orderReturnLabel">Statut :</span>
                    <span className="orderReturnStrong">{order.status}</span>
                  </div>

                  <div>
                    <span className="orderReturnLabel">Total :</span>
                    <span className="orderReturnStrong">
                      {formatMoney(order.totalCents, order.currency)}
                    </span>
                  </div>
                </div>
              </div>

              {/* --------- Articles --------- */}
              {order.items?.length ? (
                <div className="orderReturnSection">
                  <div className="orderReturnSectionTitle">Articles</div>
                  <div className="orderReturnItems">
                    {order.items.map((it, idx) => (
                      <div key={idx} className="orderReturnItemRow">
                        <div className="orderReturnItemLeft">
                          <div className="orderReturnItemName">{it.name ?? "Article"}</div>
                          <div className="orderReturnItemQty">Quantité : {it.quantity ?? 1}</div>
                        </div>
                        <div className="orderReturnItemPrice">
                          {formatMoney(
                            it.totalCents ?? (it.unitPriceCents ?? 0) * (it.quantity ?? 1),
                            it.currency ?? order.currency,
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* --------- Footer actions --------- */}
            <div className="orderReturnFooter" style={{ gap: 10, flexWrap: "wrap" }}>
              <Button onClick={() => loadOnce({ silent: false })} disabled={isRefreshing} variant="secondary">
                {isRefreshing ? "Rafraîchissement…" : "Rafraîchir"}
              </Button>

              <Button
                variant="primary"
                onClick={() => {
                  window.location.href = "https://www.useeventflow.eu";
                }}
              >
                Retourner à l'accueil
              </Button>
            </div>

              {/* petit hint si tu veux */}
              {error ? <div className="orderReturnHint">⚠️ {error}</div> : null}
            </CardBody>
          </Card>
        </div>
      </Container>
    </div>
  );
}