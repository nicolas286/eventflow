import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  ticketCheckInResponseSchema,
  ticketQrCheckInRequestSchema,
} from "@contracts/ticket-check-in";
export type MarkTicketCheckedInByQrParams = {
  qrToken: string;
  eventId: string;
};
export function markTicketCheckedInByQrRepo(supabase: SupabaseClient) {
  return {
    async markTicketCheckedInByQr(params: MarkTicketCheckedInByQrParams) {
      const body = ticketQrCheckInRequestSchema.parse(params);
      const raw = await edgeSafe<unknown>(
        () =>
          supabase.functions.invoke("orders/admin/ticket-check-in-qr", {
            body,
          }),
        "ORDERS_ADMIN_EMPTY_RESPONSE",
      );
      return ticketCheckInResponseSchema.parse(raw);
    },
  };
}
