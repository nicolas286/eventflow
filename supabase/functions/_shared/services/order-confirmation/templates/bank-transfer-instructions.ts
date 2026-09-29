import { escapeHtml } from "../../../text.ts";
import { formatDateTimeBrussels, formatMoney } from "../../../format.ts";

export function buildBankTransferInstructionsHtml(input: {
  eventTitle: string;
  startsAt: string | null;
  location: string | null;
  orderUrl: string;
  amountCents: number;
  currency: string;
  beneficiary: string;
  iban: string;
  communication: string;
  internalReference: string;
  paymentDueAt: string | null;
}) {
  const when = formatDateTimeBrussels(input.startsAt);
  const amount = formatMoney(input.amountCents, input.currency);

  return `
<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;line-height:1.6;color:#111;background:#fafafa;padding:24px">
  <div style="max-width:680px;margin:0 auto">
    <div style="background:#fff;border:1px solid #eee;border-radius:16px;padding:20px">
      <div style="font-size:18px;font-weight:900;margin:0 0 10px">Réservation enregistrée</div>
      <p style="margin:0 0 14px;color:#333">
        Votre réservation pour <strong>${
    escapeHtml(input.eventTitle)
  }</strong> est enregistrée et reste en attente de votre virement.
      </p>
      ${
    when
      ? `<p style="margin:6px 0"><strong>Date :</strong> ${
        escapeHtml(when)
      }</p>`
      : ""
  }
      ${
    input.location
      ? `<p style="margin:6px 0"><strong>Lieu :</strong> ${
        escapeHtml(input.location)
      }</p>`
      : ""
  }

      <div style="background:#f6f6f7;border-radius:14px;padding:14px 16px;margin:18px 0">
        <div style="font-weight:900;margin-bottom:8px">Coordonnées de paiement</div>
        <div><strong>Montant :</strong> ${escapeHtml(amount)}</div>
        <div><strong>Bénéficiaire :</strong> ${
    escapeHtml(input.beneficiary)
  }</div>
        <div><strong>IBAN :</strong> ${escapeHtml(input.iban)}</div>
        <div><strong>Communication :</strong> ${
    escapeHtml(input.communication)
  }</div>
        <div><strong>Référence de réservation :</strong> ${
    escapeHtml(input.internalReference)
  }</div>
        ${
    input.paymentDueAt
      ? `<div><strong>Date limite :</strong> ${escapeHtml(formatDateTimeBrussels(input.paymentDueAt) ?? input.paymentDueAt)}</div>`
      : ""
  }
      </div>

      <p style="margin:0 0 14px;color:#333">
        Vos billets seront envoyés dès que l’organisateur aura confirmé la réception du paiement.
      </p>
      <div style="text-align:center;margin:18px 0">
        <a href="${
    escapeHtml(input.orderUrl)
  }" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:800;padding:12px 18px;border-radius:999px">
          Voir ma commande
        </a>
      </div>
    </div>
    <div style="text-align:center;font-size:11px;opacity:.55;margin-top:12px">Eventflow</div>
  </div>
</div>`;
}
