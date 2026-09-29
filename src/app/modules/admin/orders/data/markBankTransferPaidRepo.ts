import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";
import {
  markBankTransferPaidResponseSchema,
  type MarkBankTransferPaidResponse,
} from "@contracts/orders-admin";

export function markBankTransferPaidRepo(supabase: SupabaseClient) {
  return {
    async markPaid(orderId: string): Promise<MarkBankTransferPaidResponse> {
      const raw = await edgeSafe<unknown>(
        () =>
          supabase.functions.invoke(`orders/admin/${orderId}/mark-paid`, {
            body: {},
          }),
        "MARK_BANK_TRANSFER_PAID_EMPTY_RESPONSE",
      );
      return markBankTransferPaidResponseSchema.parse(raw);
    },
  };
}
