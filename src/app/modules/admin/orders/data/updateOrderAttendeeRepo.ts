import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";
import {
  adminUpdateOrderAttendeeInputSchema, adminUpdateOrderAttendeeResultSchema,
  type AdminUpdateOrderAttendeeInput, type AdminUpdateOrderAttendeeResult,
} from "@contracts/orders-management";
export function adminUpdateOrderAttendeeRepo(supabase: SupabaseClient) {
  return {
    async updateOrderAttendee(input: AdminUpdateOrderAttendeeInput): Promise<AdminUpdateOrderAttendeeResult> {
      const body = adminUpdateOrderAttendeeInputSchema.parse(input);
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("orders/admin/participant-update", { body }),
        "ORDERS_ADMIN_EMPTY_RESPONSE",
      );
      return adminUpdateOrderAttendeeResultSchema.parse(raw);
    },
  };
}
