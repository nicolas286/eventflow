import { orderPublicSchema } from "@contracts/orders-read";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation, useSearchParams } from "react-router-dom";

import { Button } from "@shared/ui/components";
import { useWidgetTheme } from "../hooks/useWidgetTheme";
import { formatMoney } from "../../register/helpers/checkoutStore";
import { MessageBox } from "@ui/components/message/MessageBox";

import "./WidgetConfirmationPage.css";
import { useWidgetAutoResize } from "../hooks/useWidgetAutoResize";
import { WidgetFooter } from "../components/WidgetFooter/WidgetFooter";
import { WidgetRoot } from "../components/WidgetRoot/WidgetRoot";

type WidgetConfirmationData = {
  orderId: string;
  buyerEmail: string;
  totalCents: number;
  currency: string;
  totalTickets: number;
  eventTitle: string;
  bookingToken?: string | null;
  status?: string | null;
  items?: Array<{
    name: string;
    quantity: number;
    totalCents: number;
    currency: string;
  }>;
};

type OrderStatus =
  | "open"
  | "pending"
  | "paid"
  | "failed"
  | "cancelled"
  | "canceled"
  | "expired"
  | "awaiting_payment"
  | "partially_paid";

type OrderItemPublic = {
  name?: string;
  quantity?: number;
  unitPriceCents?: number;
  totalCents?: number;
  currency?: string;
};

type OrderPublic = {
  id: string;
  status: OrderStatus;
  totalCents?: number;
  currency?: string;
  buyerEmail?: string;
  items?: OrderItemPublic[];
};

async function fetchOrder(orderId: string, token: string): Promise<OrderPublic> {
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/orders/${encodeURIComponent(
      orderId
    )}?token=${encodeURIComponent(token)}`,
    {
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
    }
  );

  if (!res.ok) {
    throw new Error("order_fetch_failed");
  }

  const parsed = orderPublicSchema.parse(await res.json());
  const j = { ...parsed, totalCents: parsed.totalCents ?? undefined, currency: parsed.currency ?? undefined };

  return {
    id: j.id,
    status: j.status,
    totalCents: j.totalCents,
    currency: j.currency,

  };
}

function isSuccessStatus(status?: string | null) {
  return status === "paid" || status === "partially_paid";
}

export function WidgetConfirmationPage() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const [searchParams] = useSearchParams();
  const theme = useWidgetTheme();
  useWidgetAutoResize();

  const { orgSlug, eventSlug } = useParams<{
    orgSlug: string;
    eventSlug: string;
  }>();

  const orderIdFromUrl = searchParams.get("orderId");
  const tokenFromUrl = searchParams.get("token") ?? searchParams.get("bookingToken");
  const isPaymentReturn = Boolean(orderIdFromUrl && tokenFromUrl);

  const confirmationKey =
    orgSlug && eventSlug
      ? `eventflow:widget:confirmation:${orgSlug}:${eventSlug}`
      : null;

  const storedData = useMemo<WidgetConfirmationData | null>(() => {
    if (!confirmationKey) return null;

    const raw = sessionStorage.getItem(confirmationKey);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as WidgetConfirmationData;
    } catch {
      return null;
    }
  }, [confirmationKey]);

  const [remoteOrder, setRemoteOrder] = useState<OrderPublic | null>(null);
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  useEffect(() => {
  if (!orderIdFromUrl || !tokenFromUrl) return;

  let cancelled = false;

  async function run() {
    try {
      setLoadingRemote(true);
      setRemoteError(null);

      const order = await fetchOrder(orderIdFromUrl!, tokenFromUrl!);

      if (cancelled) return;

      setRemoteOrder(order);
    } catch {
      if (cancelled) return;
      setRemoteError("Impossible de récupérer la commande.");
    } finally {
      if (!cancelled) setLoadingRemote(false);
    }
  }

  run();

  return () => {
    cancelled = true;
  };
}, [orderIdFromUrl, tokenFromUrl]);

  function goBackToEvents() {
    if (!orgSlug) return;
    navigate(`/widget/o/${orgSlug}${search}`);
  }

  if (!orgSlug || !eventSlug) {
    return <div className="widgetRoot">Confirmation introuvable.</div>;
  }

  const resolvedTitle = storedData?.eventTitle ?? "votre événement";
  const resolvedData =
    isPaymentReturn && remoteOrder
      ? {
          orderId: remoteOrder.id,
          buyerEmail: remoteOrder.buyerEmail ?? "",
          totalCents: remoteOrder.totalCents ?? 0,
          currency: remoteOrder.currency ?? "EUR",
          totalTickets: (remoteOrder.items ?? []).reduce((acc, it) => acc + Number(it.quantity ?? 0), 0),
          eventTitle: resolvedTitle,
          status: remoteOrder.status,
          items: (remoteOrder.items ?? []).map((it) => ({
            name: it.name ?? "Billet",
            quantity: Number(it.quantity ?? 1),
            totalCents: Number(
              it.totalCents ?? Number(it.unitPriceCents ?? 0) * Number(it.quantity ?? 1)
            ),
            currency: it.currency ?? remoteOrder.currency ?? "EUR",
          })),
        }
      : storedData;

  const showLoading = isPaymentReturn && loadingRemote && !resolvedData;

  if (showLoading) {
    return (
      <div
        className="widgetRoot"
        style={
          {
            "--widget-bg": theme.bg,
            "--widget-card": theme.card,
            "--widget-text": theme.text,
            "--widget-button": theme.button,
          } as React.CSSProperties
        }
      >
        <div className="widgetConfirmationCard">
          <h2>Confirmation</h2>
          <div className="widgetEmpty">Chargement de votre commande…</div>
        </div>
      </div>
    );
  }

  if (!resolvedData) {
    return (
      <div
        className="widgetRoot"
        style={
          {
            "--widget-bg": theme.bg,
            "--widget-card": theme.card,
            "--widget-text": theme.text,
            "--widget-button": theme.button,
          } as React.CSSProperties
        }
      >
        <div className="widgetConfirmationCard">
          <h2>Confirmation</h2>

          {remoteError ? (
            <MessageBox variant="error">{remoteError}</MessageBox>
          ) : (
            <div className="widgetEmpty">Impossible de retrouver les détails de la réservation.</div>
          )}

          <div className="widgetRecap widgetRecapActions">
            <Button label="Retour aux événements" onClick={goBackToEvents} />
          </div>
        </div>
      </div>
    );
  }

  const isSuccess = isSuccessStatus(resolvedData.status);

  return (
    <WidgetRoot theme={theme}>
      <div className="widgetConfirmationCard">
        <div className="widgetConfirmationPill">
          {isSuccess ? "Réservation confirmée ✅" : "Commande enregistrée"}
        </div>

        <h2>{isSuccess ? "Merci !" : "Confirmation"}</h2>

        <p className="widgetConfirmationSubtitle">
          Votre réservation pour <strong>{resolvedData.eventTitle}</strong> est bien enregistrée.
        </p>

        {resolvedData.buyerEmail ? (
          <p className="widgetConfirmationSubtitle">
            Un email de confirmation sera envoyé à <strong>{resolvedData.buyerEmail}</strong>.
          </p>
        ) : null}

        {remoteError ? <MessageBox variant="error">{remoteError}</MessageBox> : null}

        <div className="widgetConfirmationSection">
          <div className="widgetSectionTitle">Récapitulatif</div>

          <div className="widgetPaymentRows">
            {resolvedData.items?.map((it, idx) => (
              <div key={idx} className="widgetPaymentRow">
                <div>
                  <div className="widgetPaymentRowTitle">
                    {it.name} × {it.quantity}
                  </div>
                </div>
                <div className="widgetPaymentAmount">
                  {formatMoney(it.totalCents, it.currency)}
                </div>
              </div>
            ))}
          </div>

          <div className="widgetDivider" />

          <div className="widgetPaymentTotalRow">
            <div>Total</div>
            <div>{formatMoney(resolvedData.totalCents, resolvedData.currency)}</div>
          </div>

          <div className="widgetPaymentInfos">
            <div>Billets : {resolvedData.totalTickets}</div>
            <div>Commande : {resolvedData.orderId}</div>
          </div>
        </div>

        <div className="widgetRecap widgetRecapActions">
          <Button className="widgetButton" variant="secondary" label="Retour aux événements" onClick={goBackToEvents} />
        </div>
      </div>

      <WidgetFooter/>
    </WidgetRoot>
  );
}

export default WidgetConfirmationPage;