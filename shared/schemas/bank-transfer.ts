import { z } from "zod";
import { acceptOrganizationSalesTermsSchema } from "./organization-sales-terms.ts";

// Historical bank-transfer data remains supported, but new event payments
// cannot select or execute this method until this global flag is enabled.
export const BANK_TRANSFER_EVENT_PAYMENTS_ENABLED = false;

export function normalizeIban(value: string): string {
  return value.replace(/\s+/gu, "").toUpperCase();
}

export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}[0-9]{2}[0-9A-Z]+$/u.test(iban)) return false;
  if (iban.length < 15 || iban.length > 34) return false;

  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
  let remainder = 0;

  for (const character of rearranged) {
    const digits = /[0-9]/u.test(character)
      ? character
      : String(character.charCodeAt(0) - 55);

    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder === 1;
}

export function maskIban(value: string): string {
  const iban = normalizeIban(value);
  if (iban.length < 6) return "•".repeat(iban.length);

  const masked = `${iban.slice(0, 2)}${"•".repeat(iban.length - 6)}${iban.slice(-4)}`;
  return masked.match(/.{1,4}/gu)?.join(" ") ?? masked;
}

export const ibanSchema = z
  .string()
  .trim()
  .max(64)
  .transform(normalizeIban)
  .refine(isValidIban, "L’IBAN est invalide");

export const bankTransferInstructionsSchema = z.object({
  internalReference: z.string().min(1).max(100),
  communication: z.string().min(1).max(500),
  beneficiary: z.string().min(2).max(160),
  iban: ibanSchema,
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
  paymentDueAt: z.string().nullable(),
});

export const updateOrganizationPaymentSettingsSchema = z
  .object({
    action: z.literal("update"),
    orgId: z.uuid(),
    paymentsProvider: z.enum(["stripe", "bank_transfer"]),
    bankTransferBeneficiary: z.string().trim().max(160).nullable(),
    bankTransferIban: z.string().trim().max(64).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.paymentsProvider !== "bank_transfer") return;

    if (!BANK_TRANSFER_EVENT_PAYMENTS_ENABLED) {
      ctx.addIssue({
        code: "custom",
        path: ["paymentsProvider"],
        message: "Le paiement par virement n’est pas encore disponible",
      });
      return;
    }

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

export const readOrganizationPaymentSettingsSchema = z.object({
  action: z.literal("read"),
  orgId: z.uuid(),
});

export const organizationPaymentSettingsRequestSchema = z.union([
  readOrganizationPaymentSettingsSchema,
  updateOrganizationPaymentSettingsSchema,
  acceptOrganizationSalesTermsSchema,
]);

export const organizationPaymentSettingsResultSchema = z.object({
  orgId: z.uuid(),
  paymentsProvider: z.enum(["stripe", "bank_transfer"]),
  bankTransferBeneficiary: z.string().nullable(),
  bankTransferIban: z.string().nullable(),
  bankTransferIbanMasked: z.string().nullable(),
  salesTerms: z.string().nullable().optional(),
  salesTermsVersion: z.string().nullable().optional(),
  salesTermsAcceptedVersion: z.string().nullable().optional(),
  salesTermsAcceptedAt: z.string().nullable().optional(),
  salesTermsAcceptedBy: z.uuid().nullable().optional(),
  salesTermsCurrent: z.boolean().optional(),
  bankTransferIbanChanged: z.boolean().optional(),
  securityEmailSent: z.boolean().optional(),
});

export const bankTransferAdminSummarySchema = z.object({
  orderId: z.uuid(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3),
  internalReference: z.string().min(1),
  communication: z.string().nullable(),
  createdAt: z.string(),
  paymentDueAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  confirmedBy: z.uuid().nullable(),
});

export const bankTransferAdminSummariesSchema = z.array(
  bankTransferAdminSummarySchema,
);

export const expireBankTransferOrderResultSchema = z.object({
  ok: z.literal(true),
  orderId: z.uuid(),
  status: z.literal("expired"),
  releasedUnits: z.number().int().nonnegative(),
  idempotent: z.boolean(),
});

export type BankTransferInstructions = z.infer<
  typeof bankTransferInstructionsSchema
>;
export type OrganizationPaymentSettingsRequest = z.input<
  typeof organizationPaymentSettingsRequestSchema
>;
export type UpdateOrganizationPaymentSettings = z.input<
  typeof updateOrganizationPaymentSettingsSchema
>;
export type OrganizationPaymentSettingsResult = z.infer<
  typeof organizationPaymentSettingsResultSchema
>;
export type BankTransferAdminSummary = z.infer<
  typeof bankTransferAdminSummarySchema
>;
