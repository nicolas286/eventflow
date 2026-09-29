import {
  normalizeIban,
  organizationPaymentSettingsResultSchema,
} from "@contracts/bank-transfer";
import { z } from "zod";

export const updatePaymentSettingsInputSchema = z
  .object({
    orgId: z.uuid(),
    paymentsProvider: z.literal("stripe"),
    bankTransferBeneficiary: z.string().trim().max(160).nullable(),
    bankTransferIban: z.string().trim().max(64).nullable(),
  })
  .transform((value) => ({
    ...value,
    bankTransferBeneficiary: value.bankTransferBeneficiary?.trim() || null,
    bankTransferIban: value.bankTransferIban
      ? normalizeIban(value.bankTransferIban)
      : null,
  }));

export const updatePaymentSettingsResultSchema =
  organizationPaymentSettingsResultSchema;

export type UpdatePaymentSettingsInput = z.input<
  typeof updatePaymentSettingsInputSchema
>;
export type UpdatePaymentSettingsResult = z.infer<
  typeof updatePaymentSettingsResultSchema
>;
