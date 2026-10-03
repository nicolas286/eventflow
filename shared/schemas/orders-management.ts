import { z } from "zod";
export * from "./orders-management-data.ts";
import { eventParticipantsExportSchema } from "./orders-management-data.ts";
import { bankTransferAdminSummariesSchema } from "./bank-transfer.ts";

const eventShape = {
  eventId: z.uuid().optional(),
  orgId: z.uuid().optional(),
  eventSlug: z.string().min(1).max(200).optional(),
};
function validEvent(
  input: { eventId?: string; orgId?: string; eventSlug?: string },
) {
  return Boolean(
    input.eventId && !input.eventSlug ||
      !input.eventId && input.orgId && input.eventSlug,
  );
}
const paging = {
  ordersLimit: z.number().int().min(1).max(1000).default(50),
  ordersOffset: z.number().int().min(0).max(10_000_000).default(0),
};
export const ordersListRequestSchema = z.object({ ...eventShape, ...paging })
  .strict().refine(validEvent);
export const ordersSearchRequestSchema = z.object({
  ...eventShape,
  ...paging,
  query: z.string().max(500),
  filterMode: z.string().regex(/^(all|order|field:.{1,100})$/),
}).strict().refine(validEvent);
export const ticketsSearchRequestSchema = z.object({
  eventId: z.uuid(),
  orgId: z.uuid().optional(),
  query: z.string().max(500),
  limit: z.number().int().min(1).max(1000).default(50),
  offset: z.number().int().min(0).max(10_000_000).default(0),
}).strict();
export const participantsExportCursorSchema = z.object({
  after: z.uuid(),
  through: z.uuid(),
  snapshot: z.iso.datetime({ offset: true }),
}).strict();
export const participantsExportRequestSchema = z.object({
  ...eventShape,
  confirmedOnly: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(100),
  cursor: participantsExportCursorSchema.nullable().optional(),
}).strict().refine(validEvent);
export const participantsExportPageSchema = eventParticipantsExportSchema
  .extend({
    nextCursor: participantsExportCursorSchema.nullable(),
  });
export const orderMutationRequestSchema = z.object({
  orderId: z.uuid(),
  eventId: z.uuid().optional(),
  orgId: z.uuid().optional(),
}).strict();
export const bankSummariesRequestSchema = z.object({
  eventId: z.uuid(),
  orgId: z.uuid().optional(),
  limit: z.number().int().min(1).max(100).default(100),
  after: z.uuid().nullable().optional(),
}).strict();
export const bankSummariesPageSchema = z.object({
  items: bankTransferAdminSummariesSchema,
  nextAfter: z.uuid().nullable(),
}).strict();
