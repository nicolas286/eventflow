import { useMemo } from "react";
import { useNavigate, useParams, useLocation, useSearchParams } from "react-router-dom";

import { Button } from "@shared/ui/components";
import { useWidgetTheme } from "../hooks/useWidgetTheme";
import { formatMoney } from "../../register/helpers/checkoutStore";
import { MessageBox } from "@ui/components/message/MessageBox";

import "./WidgetConfirmationPage.css";
import { useWidgetAutoResize } from "../hooks/useWidgetAutoResize";
import { WidgetFooter } from "../components/WidgetFooter/WidgetFooter";
import { WidgetRoot } from "../components/WidgetRoot/WidgetRoot";
import { readCachedWidgetConfirmation, resolveWidgetOrderCredentials } from "../helpers/widgetConfirmation";
import { useWidgetConfirmationOrder } from "../hooks/useWidgetConfirmationOrder";

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

  const confirmationKey =
    orgSlug && eventSlug
      ? `eventflow:widget:confirmation:${orgSlug}:${eventSlug}`
      : null;

  const storedData = useMemo(() => {
    if (!confirmationKey) return null;
    try {
      return readCachedWidgetConfirmation(sessionStorage.getItem(confirmationKey));
    } catch {
      return null;
    }
  }, [confirmationKey]);

  const credentials = useMemo(
    () => resolveWidgetOrderCredentials(orderIdFromUrl, tokenFromUrl, storedData),
    [orderIdFromUrl, tokenFromUrl, storedData],
  );
  const { order: remoteOrder, loading: loadingRemote, error: remoteError, refresh } =
    useWidgetConfirmationOrder(credentials);

  function goBackToEvents() {
    if (!orgSlug) return;
    const eventSearch = new URLSearchParams(search);
    for (const key of ["orderId", "token", "bookingToken"]) eventSearch.delete(key);
    const query = eventSearch.toString();
    navigate(`/widget/o/${orgSlug}${query ? `?${query}` : ""}`);
  }

  if (!orgSlug || !eventSlug) {
    return <div className="widgetRoot">Confirmation introuvable.</div>;
  }

  const matchingStoredData = storedData?.orderId === remoteOrder?.id ? storedData : null;
  const resolvedData = remoteOrder
      ? {
          orderId: remoteOrder.id,
          buyerEmail: matchingStoredData?.buyerEmail ?? "",
          totalCents: remoteOrder.totalCents ?? 0,
          currency: remoteOrder.currency ?? "EUR",
          totalTickets: matchingStoredData?.totalTickets,
          eventTitle: matchingStoredData?.eventTitle ?? "votre événement",
          status: remoteOrder.status,
          paymentMethod: remoteOrder.paymentMethod,
          bankTransfer: remoteOrder.bankTransfer ?? null,
          items: matchingStoredData?.items,
        }
      : null;

  if (loadingRemote) {
    return (
      <WidgetRoot theme={theme}>
        <div className="widgetConfirmationCard">
          <h2>Confirmation</h2>
          <div className="widgetEmpty">Chargement de votre commande…</div>
        </div>
      </WidgetRoot>
    );
  }

  if (!resolvedData) {
    return (
      <WidgetRoot theme={theme}>
        <div className="widgetConfirmationCard">
          <h2>Confirmation</h2>

          {remoteError ? (
            <MessageBox variant="error">{remoteError}</MessageBox>
          ) : (
            <div className="widgetEmpty">Impossible de vérifier cette réservation. Utilisez le lien reçu par e-mail.</div>
          )}

          <div className="widgetRecap widgetRecapActions">
            {credentials ? <Button label="Réessayer" onClick={refresh} /> : null}
            <Button label="Retour aux événements" onClick={goBackToEvents} />
          </div>
        </div>
      </WidgetRoot>
    );
  }

  const isSuccess = isSuccessStatus(resolvedData.status);
  const isExpired = resolvedData.status === "expired";
  const isCanceled = resolvedData.status === "canceled" || resolvedData.status === "cancelled";
  const isFailed = resolvedData.status === "failed";
  const isClosed = isExpired || isCanceled || isFailed;
  const isAwaitingTransfer = resolvedData.paymentMethod === "bank_transfer" &&
    resolvedData.status === "awaiting_payment";

  return (
    <WidgetRoot theme={theme}>
      <div className="widgetConfirmationCard">
        <div className="widgetConfirmationPill">
          {isSuccess ? "Réservation confirmée ✅" : isExpired ? "Réservation expirée" : isCanceled ? "Réservation annulée" : isFailed ? "Paiement échoué" : "Commande enregistrée"}
        </div>

        <h2>{isSuccess ? "Merci !" : "Confirmation"}</h2>

        <p className="widgetConfirmationSubtitle">
          {isClosed ? <>Cette réservation pour <strong>{resolvedData.eventTitle}</strong> n’est plus active.</> : <>Votre réservation pour <strong>{resolvedData.eventTitle}</strong> est bien enregistrée.</>}
        </p>

        {isClosed ? (
          <MessageBox variant="info">
            N’effectuez pas de virement pour cette réservation. Contactez l’organisateur si vous avez déjà effectué le paiement.
          </MessageBox>
        ) : null}

        {isAwaitingTransfer ? (
          <MessageBox variant="info">
            Les coordonnées de paiement ont été envoyées par e-mail. Vos billets seront émis après confirmation du virement par l’organisateur.
          </MessageBox>
        ) : null}

        {isAwaitingTransfer &&
        resolvedData.bankTransfer ? (
          <div className="widgetConfirmationSection">
            <div className="widgetSectionTitle">Instructions de virement</div>
            <div className="widgetPaymentInfos">
              <div>
                Montant :{" "}
                <strong>
                  {formatMoney(
                    resolvedData.bankTransfer.amountCents,
                    resolvedData.bankTransfer.currency,
                  )}
                </strong>
              </div>
              <div>
                Bénéficiaire : <strong>{resolvedData.bankTransfer.beneficiary}</strong>
              </div>
              <div>
                IBAN : <strong>{resolvedData.bankTransfer.iban}</strong>
              </div>
              <div>
                Communication : <strong>{resolvedData.bankTransfer.communication}</strong>
              </div>
              <div>
                Référence Eventflow :{" "}
                <strong>{resolvedData.bankTransfer.internalReference}</strong>
              </div>
            </div>
            <p className="widgetConfirmationSubtitle">
              Votre place sera définitivement confirmée après réception du paiement.
            </p>
          </div>
        ) : null}

        {isSuccess && resolvedData.buyerEmail ? (
          <p className="widgetConfirmationSubtitle">
            Un email de confirmation sera envoyé à <strong>{resolvedData.buyerEmail}</strong>.
          </p>
        ) : null}

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
            {resolvedData.totalTickets !== undefined ? <div>Billets : {resolvedData.totalTickets}</div> : null}
            <div>Commande : {resolvedData.orderId}</div>
          </div>
        </div>

        <div className="widgetRecap widgetRecapActions">
          <Button className="widgetButton" variant="secondary" label="Actualiser le statut" onClick={refresh} />
          <Button className="widgetButton" variant="secondary" label="Retour aux événements" onClick={goBackToEvents} />
        </div>
      </div>

      <WidgetFooter/>
    </WidgetRoot>
  );
}

export default WidgetConfirmationPage;
