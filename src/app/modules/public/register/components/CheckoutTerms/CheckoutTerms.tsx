import { useId } from "react";
import Button from "@ui/components/button/Button";
import { MessageBox } from "@ui/components/message/MessageBox";
import "./CheckoutTerms.css";

type Props = {
  organizerName?: string;
  salesTermsRead: boolean;
  organizerTermsAvailable: boolean;
  accepted: boolean;
  disabled: boolean;
  charterPending?: boolean;
  error: string | null;
  onRead: () => void;
  onAcceptedChange: (accepted: boolean) => void;
};

export function CheckoutTerms({
  organizerName,
  salesTermsRead,
  organizerTermsAvailable,
  accepted,
  disabled,
  charterPending = false,
  error,
  onRead,
  onAcceptedChange,
}: Props) {
  const id = useId();
  const requiresReading = organizerName !== undefined;
  const acceptanceDisabled =
    disabled ||
    charterPending ||
    (requiresReading && (!organizerTermsAvailable || !salesTermsRead));

  return (
    <div className="checkoutTerms">
      {requiresReading ? (
        <div className="checkoutTermsReading">
          <div className="checkoutTermsReadingText">
            <div className="checkoutTermsStep">
              <span className="checkoutTermsNumber" aria-hidden="true">
                1
              </span>
              <h3>Lire les conditions de vente</h3>
            </div>
            <p>Prenez connaissance des conditions de {organizerName}.</p>
          </div>
          <div className="checkoutTermsReadAction">
            <Button
              className="checkoutTermsReadButton"
              variant="secondary"
              label={
                salesTermsRead ? "Relire les conditions" : "Lire les conditions"
              }
              onClick={onRead}
              disabled={disabled || !organizerTermsAvailable}
            />
            <span
              className={
                salesTermsRead
                  ? "checkoutTermsStatus checkoutTermsStatus--read"
                  : "checkoutTermsStatus"
              }
            >
              {salesTermsRead
                ? "✓ Lecture confirmée"
                : "À lire avant d’accepter"}
            </span>
          </div>
        </div>
      ) : null}

      <div className="checkoutTermsStep">
        {requiresReading ? (
          <span className="checkoutTermsNumber" aria-hidden="true">
            2
          </span>
        ) : null}
        <h3>Accepter et confirmer</h3>
      </div>
      <p id={`${id}-help`} className="checkoutTermsHelp">
        {requiresReading && !organizerTermsAvailable
          ? "L’organisateur doit valider ses conditions de vente avant de pouvoir accepter des paiements."
          : requiresReading && !salesTermsRead
            ? "Lisez d’abord les conditions pour pouvoir cocher la case ci-dessous."
            : charterPending
              ? "Lisez la charte de l’événement pour pouvoir cocher la case ci-dessous."
              : "Cochez la case ci-dessous pour confirmer votre accord."}
      </p>
      <label
        className={`checkoutTermsAcceptance${error ? " checkoutTermsAcceptance--error" : ""}`}
      >
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => onAcceptedChange(event.target.checked)}
          disabled={acceptanceDisabled}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          aria-invalid={error ? true : undefined}
        />
        <span>
          J’accepte{" "}
          {requiresReading ? (
            <>les conditions de {organizerName} et les </>
          ) : (
            "les "
          )}
          <a href="/conditions-billetterie" target="_blank" rel="noreferrer">
            Conditions de billetterie Eventflow
          </a>
          . Je prends connaissance de la{" "}
          <a href="/politique-confidentialite" target="_blank" rel="noreferrer">
            politique de confidentialité
          </a>
          {requiresReading
            ? " et je confirme mon achat."
            : " et je confirme ma réservation."}
        </span>
      </label>
      {error ? (
        <div id={`${id}-error`}>
          <MessageBox variant="error">{error}</MessageBox>
        </div>
      ) : null}
    </div>
  );
}
