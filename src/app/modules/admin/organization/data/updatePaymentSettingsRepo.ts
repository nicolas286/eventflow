import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseSafe } from "@gateways/supabase/supabaseSafe";
import {
  type UpdatePaymentSettingsInput,
  type UpdatePaymentSettingsResult,
  updatePaymentSettingsInputSchema,
  updatePaymentSettingsResultSchema,
} from "../schemas/admin.updatePaymentSettings.schema";

export function updatePaymentSettingsRepo(supabase: SupabaseClient) {
  return {
    async update(
      input: UpdatePaymentSettingsInput,
    ): Promise<UpdatePaymentSettingsResult> {
      const parsed = updatePaymentSettingsInputSchema.parse(input);
      const raw = await supabaseSafe(() =>
        supabase.rpc("update_organization_payment_settings", {
          p_org_id: parsed.orgId,
          p_provider: parsed.paymentsProvider,
          p_bank_transfer_beneficiary: parsed.bankTransferBeneficiary,
          p_bank_transfer_iban: parsed.bankTransferIban,
        }),
      );
      return updatePaymentSettingsResultSchema.parse(raw);
    },
  };
}
