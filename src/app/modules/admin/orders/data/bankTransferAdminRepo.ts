import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseSafe } from "@gateways/supabase/supabaseSafe";
import {
  bankTransferAdminSummariesSchema,
  expireBankTransferOrderResultSchema,
  type BankTransferAdminSummary,
} from "@contracts/bank-transfer";

export function bankTransferAdminRepo(supabase: SupabaseClient) {
  return {
    async list(eventId: string): Promise<BankTransferAdminSummary[]> {
      const raw = await supabaseSafe<unknown>(() =>
        supabase.rpc("get_bank_transfer_admin_summaries", {
          p_event_id: eventId,
        }),
      );

      return bankTransferAdminSummariesSchema.parse(raw);
    },

    async expire(orderId: string) {
      const raw = await supabaseSafe<unknown>(() =>
        supabase.rpc("expire_bank_transfer_order", {
          p_order_id: orderId,
        }),
      );

      return expireBankTransferOrderResultSchema.parse(raw);
    },
  };
}
