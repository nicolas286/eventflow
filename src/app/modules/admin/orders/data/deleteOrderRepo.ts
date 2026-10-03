import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { deleteOrderInputSchema, type DeleteOrderInput } from "../schemas/admin.deleteOrderInput.schema";
import { adminDeleteOrderResultSchema, orderMutationRequestSchema } from "@contracts/orders-management";
export function deleteOrderRepo(supabase: SupabaseClient) {
  return {
    async deleteOrder(input: DeleteOrderInput): Promise<void> {
      const { id, orgId, eventId } = deleteOrderInputSchema.parse(input);
      const body = orderMutationRequestSchema.parse({ orderId: id, orgId, eventId });
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("orders/admin/delete", { body }),
        "ORDERS_ADMIN_EMPTY_RESPONSE",
      );
      adminDeleteOrderResultSchema.parse(raw);
    },
  };
}
