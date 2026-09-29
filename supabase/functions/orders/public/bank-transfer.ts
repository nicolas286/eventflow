import { internal } from "../../_shared/errors.ts";
import type { EdgeLogger } from "../../_shared/modules/logger/mod.ts";
import type { AdminClient } from "../../_shared/supabase.ts";
import { sendBankTransferInstructions } from "../../_shared/services/order-confirmation/index.ts";

export function bankTransferPaymentId(orderId: string) {
  return `bank_transfer:${orderId}`;
}

export function bankTransferCommunication(orderId: string) {
  return `EVENTFLOW ${orderId.slice(0, 8).toUpperCase()}`;
}

export async function createBankTransferPaymentOrThrow(input: {
  admin: AdminClient;
  logger: EdgeLogger;
  orderId: string;
  amountCents: number;
  currency: string;
  beneficiary: string;
  iban: string;
}) {
  const providerPaymentId = bankTransferPaymentId(input.orderId);
  const communication = bankTransferCommunication(input.orderId);
  const now = new Date().toISOString();

  const { error } = await input.admin.from("payments").insert({
    order_id: input.orderId,
    provider: "offline",
    provider_payment_id: providerPaymentId,
    provider_account_id: null,
    provider_checkout_session_id: null,
    amount_cents: input.amountCents,
    currency: input.currency,
    status: "open",
    is_refund: false,
    created_at: now,
    updated_at: now,
    processed_at: null,
    raw: {
      method: "bank_transfer",
      beneficiary: input.beneficiary,
      iban: input.iban,
      communication,
    },
    type: "payment",
    parent_payment_id: null,
  });

  if (error) throw internal("BANK_TRANSFER_PAYMENT_DB_INSERT_FAILED");

  try {
    await sendBankTransferInstructions(input.admin, input.logger, {
      orderId: input.orderId,
      beneficiary: input.beneficiary,
      iban: input.iban,
      amountCents: input.amountCents,
      currency: input.currency,
      communication,
    });
  } catch (emailError) {
    input.logger.error("bank_transfer_instructions_email_failed", {
      orderId: input.orderId,
      error: emailError,
    });
  }

  return { providerPaymentId, communication };
}
