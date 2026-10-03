import { z } from "zod";

import { adminEventDetailEventSchema, adminEventDetailOrgBrandingSchema, eventFormFieldsSchema } from "@contracts/events";
export {
  adminEventDetailEventSchema, adminEventDetailOrgBrandingSchema,
  eventFormFieldsSchema, eventFormFieldGroupsSchema, eventDetailAdminCoreSchema,
  type AdminEventDetailEvent, type EventDetailAdminCore,
} from "@contracts/events";

import { eventProductsSchema } from "@shared/models/db/db.eventProducts.schema";
import { orderItemsSchema } from "@shared/models/db/db.orderItems.schema";
import { paymentsUISchema } from "@shared/models/db/db.payment.schema";
import { attendeesSchema } from "@shared/models/db/db.attendee.schema";
import { attendeesAnswersSchema } from "@shared/models/db/db.attendeeAnswers.schema";
import { ordersUISchema } from "../../orders/schemas/admin.ordersSchema";

/**
 * RPC: get_event_detail_admin
 * Retour historique:
 * {
 *  event,
 *  orgBranding,
 *  products,
 *  formFields,
 *  orders: {limit, offset, rows},
 *  orderItems,
 *  payments,
 *  attendees: {limit, offset, total, rows},
 *  attendeeAnswers
 * }
 */

export const attendeesPageSchema = z.object({
  limit: z.number().int().min(1).max(1000),
  offset: z.number().int().min(0),
  total: z.number().int().min(0),
  rows: attendeesSchema,
});

export const eventDetailAdminSchema = z.object({
  event: adminEventDetailEventSchema,
  orgBranding: adminEventDetailOrgBrandingSchema,

  products: eventProductsSchema,
  formFields: eventFormFieldsSchema,

  orders: ordersUISchema,
  orderItems: orderItemsSchema,
  payments: paymentsUISchema,

  attendees: attendeesPageSchema,
  attendeeAnswers: attendeesAnswersSchema,
});

export const eventDetailAdminParticipantsSchema = z.object({
  attendees: attendeesPageSchema,
  attendeeAnswers: attendeesAnswersSchema,
});

export type AttendeesPage = z.infer<typeof attendeesPageSchema>;
export type EventDetailAdmin = z.infer<typeof eventDetailAdminSchema>;
export type EventDetailAdminParticipants = z.infer<typeof eventDetailAdminParticipantsSchema>;
