import type { SupabaseClient } from "@supabase/supabase-js";

import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { bankSummariesPageSchema, bankSummariesRequestSchema, orderMutationRequestSchema } from "@contracts/orders-management";
import {
  bankTransferAdminSummariesSchema,
  expireBankTransferOrderResultSchema,
  type BankTransferAdminSummary,
} from "@contracts/bank-transfer";

export function bankTransferAdminRepo(supabase: SupabaseClient) {
  return {
    async list(eventId: string): Promise<BankTransferAdminSummary[]> {
      const items: BankTransferAdminSummary[] = [];
      let after: string | null = null;
      do {
        const body = bankSummariesRequestSchema.parse({ eventId, after });
        const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("orders/admin/bank-summaries", { body }), "ORDERS_ADMIN_EMPTY_RESPONSE");
        const page = bankSummariesPageSchema.parse(raw);
        items.push(...page.items);
        if (after && page.nextAfter && page.nextAfter <= after) throw new Error("BANK_CURSOR_INVALID");
        after = page.nextAfter;
      } while (after);
      return bankTransferAdminSummariesSchema.parse(items).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async expire(orderId: string, eventId?: string) {
      const body = orderMutationRequestSchema.parse({ orderId, eventId });
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("orders/admin/bank-expire", { body }), "ORDERS_ADMIN_EMPTY_RESPONSE");

      return expireBankTransferOrderResultSchema.parse(raw);
    },
  };
}
