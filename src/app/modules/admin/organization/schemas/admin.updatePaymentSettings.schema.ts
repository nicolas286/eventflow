import { z } from "zod";

const normalizedIbanSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}[0-9A-Z]{13,32}$/, "IBAN invalide"));

export const updatePaymentSettingsInputSchema = z
  .object({
    orgId: z.uuid(),
    paymentsProvider: z.enum(["stripe", "bank_transfer"]),
    bankTransferBeneficiary: z.string().trim().max(160).nullable(),
    bankTransferIban: z.string().trim().max(64).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.paymentsProvider !== "bank_transfer") return;
    if (
      !value.bankTransferBeneficiary ||
      value.bankTransferBeneficiary.length < 2
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["bankTransferBeneficiary"],
        message: "Le bénéficiaire est requis",
      });
    }
    if (!normalizedIbanSchema.safeParse(value.bankTransferIban ?? "").success) {
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
      ? value.bankTransferIban.replace(/\s+/g, "").toUpperCase()
      : null,
  }));

export const updatePaymentSettingsResultSchema = z.object({
  orgId: z.uuid(),
  paymentsProvider: z.enum(["stripe", "bank_transfer"]),
  bankTransferBeneficiary: z.string().nullable(),
  bankTransferIban: z.string().nullable(),
});

export type UpdatePaymentSettingsInput = z.input<
  typeof updatePaymentSettingsInputSchema
>;
export type UpdatePaymentSettingsResult = z.infer<
  typeof updatePaymentSettingsResultSchema
>;
