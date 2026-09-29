import { internal } from "../../_shared/errors.ts";
import type { EdgeLogger } from "../../_shared/modules/logger/mod.ts";
import type { AdminClient } from "../../_shared/supabase.ts";
import { sendBankTransferInstructions } from "../../_shared/services/order-confirmation/index.ts";

export function bankTransferPaymentId(orderId: string) {
  return `bank_transfer:${orderId}`;
}

export function bankTransferInternalReference(orderId: string) {
  return `EF-${orderId.replaceAll("-", "").toUpperCase()}`;
}

function compactCommunicationPart(value: string, maxLength: number) {
  return value.replace(/\s+/gu, " ").trim().slice(0, maxLength);
}

export function bankTransferCommunication(input: {
  orderId: string;
  eventTitle: string;
  buyerEmail: string;
}) {
  return [
    "EVENTFLOW",
    compactCommunicationPart(input.eventTitle, 120),
    compactCommunicationPart(input.buyerEmail.toLowerCase(), 254),
    bankTransferInternalReference(input.orderId),
  ].join(" | ");
}

export async function createBankTransferPaymentOrThrow(input: {
  admin: AdminClient;
  logger: EdgeLogger;
  orderId: string;
  amountCents: number;
  currency: string;
  beneficiary: string;
  iban: string;
  eventTitle: string;
  buyerEmail: string;
}) {
  const internalReference = bankTransferInternalReference(input.orderId);
  const communication = bankTransferCommunication({
    orderId: input.orderId,
    eventTitle: input.eventTitle,
    buyerEmail: input.buyerEmail,
  });

  const { data: stored, error } = await input.admin.rpc(
    "create_bank_transfer_payment",
    {
      p_order_id: input.orderId,
      p_amount_cents: input.amountCents,
      p_currency: input.currency,
      p_beneficiary: input.beneficiary,
      p_iban: input.iban,
      p_communication: communication,
      p_internal_reference: internalReference,
    },
  );

  if (error) throw internal("BANK_TRANSFER_PAYMENT_DB_INSERT_FAILED");

  const instructions = {
    internalReference: String(stored?.internalReference ?? internalReference),
    communication: String(stored?.communication ?? communication),
    beneficiary: String(stored?.beneficiary ?? input.beneficiary),
    iban: String(stored?.iban ?? input.iban),
    amountCents: Number(stored?.amountCents ?? input.amountCents),
    currency: String(stored?.currency ?? input.currency),
    paymentDueAt: null,
  };

  try {
    await sendBankTransferInstructions(input.admin, input.logger, {
      orderId: input.orderId,
      ...instructions,
    });
  } catch {
    input.logger.error("bank_transfer_instructions_email_failed", {
      orderId: input.orderId,
    });
  }

  return instructions;
}
