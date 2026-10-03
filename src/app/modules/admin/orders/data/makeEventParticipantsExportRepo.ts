import type { SupabaseClient } from "@supabase/supabase-js";

import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { z } from "zod";
import { participantsExportRequestSchema, participantsExportPageSchema, participantsExportCursorSchema } from "@contracts/orders-management";


import {
  eventParticipantsExportSchema,
  type EventParticipantsExportData,
} from "../schemas/admin.getEventParticipantsExport.schema";

export type GetEventParticipantsExportParams =
  | {
      orgId: string;
      eventSlug: string;
      confirmedOnly?: boolean;
    }
  | {
      eventId: string;
      confirmedOnly?: boolean;
    };

export function makeEventParticipantsExportRepo(supabase: SupabaseClient) {
  return {
    async getEventParticipantsExportData(
      params: GetEventParticipantsExportParams,
    ): Promise<EventParticipantsExportData> {
      const base = participantsExportRequestSchema.parse(params);
      const result: EventParticipantsExportData = { orders: { rows: [] }, orderItems: [], attendees: [], attendeeAnswers: [] };
      let cursor: z.infer<typeof participantsExportCursorSchema> | null = null;
      do {
        const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("orders/admin/participants-export", {
          body: { ...base, cursor },
        }), "ORDERS_ADMIN_EMPTY_RESPONSE");
        const page = participantsExportPageSchema.parse(raw);
        result.orders.rows.push(...page.orders.rows);
        result.orderItems.push(...page.orderItems);
        result.attendees.push(...page.attendees);
        result.attendeeAnswers.push(...page.attendeeAnswers);
        if (cursor && page.nextCursor && page.nextCursor.after <= cursor.after) throw new Error("EXPORT_CURSOR_INVALID");
        cursor = page.nextCursor;
      } while (cursor);
      return eventParticipantsExportSchema.parse(result);
    },
  };
}