import { describe, expect, it } from "vitest";
import { updatePaymentSettingsInputSchema } from "../../../src/app/modules/admin/organization/schemas/admin.updatePaymentSettings.schema";
import { isValidIban, maskIban } from "../../../shared/schemas/bank-transfer";

const orgId = "11111111-1111-4111-8111-111111111111";

describe("organization payment settings", () => {
  it("normalizes a bank-transfer IBAN", () => {
    expect(updatePaymentSettingsInputSchema.parse({
      orgId,
      paymentsProvider: "bank_transfer",
      bankTransferBeneficiary: "Eventflow ASBL",
      bankTransferIban: "be51 7320 8102 5262",
    })).toMatchObject({
      bankTransferBeneficiary: "Eventflow ASBL",
      bankTransferIban: "BE51732081025262",
    });
  });

  it("requires complete bank details only for bank transfer", () => {
    expect(updatePaymentSettingsInputSchema.safeParse({
      orgId,
      paymentsProvider: "bank_transfer",
      bankTransferBeneficiary: null,
      bankTransferIban: null,
    }).success).toBe(false);
    expect(updatePaymentSettingsInputSchema.safeParse({
      orgId,
      paymentsProvider: "stripe",
      bankTransferBeneficiary: null,
      bankTransferIban: null,
    }).success).toBe(true);
  });

  it("rejects an IBAN with an invalid checksum", () => {
    expect(isValidIban("BE51 7320 8102 5262")).toBe(true);
    expect(isValidIban("BE51 7320 8102 5263")).toBe(false);
    expect(updatePaymentSettingsInputSchema.safeParse({
      orgId,
      paymentsProvider: "bank_transfer",
      bankTransferBeneficiary: "Eventflow ASBL",
      bankTransferIban: "BE51 7320 8102 5263",
    }).success).toBe(false);
  });

  it("masks an IBAN while retaining only its country and final digits", () => {
    expect(maskIban("be51 7320 8102 5262")).toBe("BE•• •••• •••• 5262");
  });
});
