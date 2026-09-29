import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";
import {
  type UpdatePaymentSettingsInput,
  type UpdatePaymentSettingsResult,
  updatePaymentSettingsInputSchema,
  updatePaymentSettingsResultSchema,
} from "../schemas/admin.updatePaymentSettings.schema";
import { organizationSalesTermsSchema } from "@contracts/organization-sales-terms";

export function updatePaymentSettingsRepo(supabase: SupabaseClient) {
  return {
    async update(
      input: UpdatePaymentSettingsInput,
    ): Promise<UpdatePaymentSettingsResult> {
      const parsed = updatePaymentSettingsInputSchema.parse(input);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organization-payment-settings", {
          body: {
            action: "update",
            orgId: parsed.orgId,
            paymentsProvider: parsed.paymentsProvider,
            bankTransferBeneficiary: parsed.bankTransferBeneficiary,
            bankTransferIban: parsed.bankTransferIban,
          },
        }),
      );
      return updatePaymentSettingsResultSchema.parse(raw);
    },
    async read(orgId: string): Promise<UpdatePaymentSettingsResult> {
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organization-payment-settings", {
          body: { action: "read", orgId },
        }),
      );
      return updatePaymentSettingsResultSchema.parse(raw);
    },
    async acceptTerms(
      orgId: string,
      salesTerms: string,
    ): Promise<UpdatePaymentSettingsResult> {
      const parsedTerms = organizationSalesTermsSchema.parse(salesTerms);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organization-payment-settings", {
          body: {
            action: "accept_terms",
            orgId,
            salesTerms: parsedTerms,
            confirmed: true,
          },
        }),
      );
      return updatePaymentSettingsResultSchema.parse(raw);
    },
  };
}
