import {
  ibanSchema,
  normalizeIban,
  organizationPaymentSettingsResultSchema,
} from "@contracts/bank-transfer";
import { z } from "zod";

export const updatePaymentSettingsInputSchema = z
  .object({
    orgId: z.uuid(),
    paymentsProvider: z.enum(["stripe", "bank_transfer"]),
    bankTransferBeneficiary: z.string().trim().max(160).nullable(),
    bankTransferIban: z.string().trim().max(64).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.paymentsProvider !== "bank_transfer") return;
    if (!value.bankTransferBeneficiary || value.bankTransferBeneficiary.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["bankTransferBeneficiary"],
        message: "Le bénéficiaire est requis",
      });
    }
    if (!ibanSchema.safeParse(value.bankTransferIban ?? "").success) {
      ctx.addIssue({
        code: "custom",
        path: ["bankTransferIban"],
        message: "L’IBAN est invalide",
      });
    }
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
