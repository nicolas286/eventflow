import { z } from "zod";

export const invoiceHistoryCursorSchema = z.strictObject({
  issuedAt: z.iso.datetime({ offset: true }).nullable(),
  id: z.uuid(),
});

export const invoiceHistoryRequestSchema = z.strictObject({
  orgId: z.uuid(),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: invoiceHistoryCursorSchema.nullable().optional(),
});

// Only the fields rendered by the history tab, plus the ID for the existing
// PDF route. No provider IDs, storage paths or billing snapshots.
export const invoiceHistoryItemSchema = z.strictObject({
  id: z.uuid(),
  number: z.string().min(3).max(40),
  status: z.enum(["draft", "issued", "paid", "void"]),
  issuedAt: z.iso.datetime({ offset: true }).nullable(),
  totalCents: z.number().int().nonnegative(),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
  paymentReference: z.string().max(80).nullable(),
});

export const invoiceHistoryResponseSchema = z.strictObject({
  orgId: z.uuid(),
  items: z.array(invoiceHistoryItemSchema).max(100),
  nextCursor: invoiceHistoryCursorSchema.nullable(),
});

export type InvoiceHistoryRequest = z.infer<typeof invoiceHistoryRequestSchema>;
export type InvoiceHistoryItem = z.infer<typeof invoiceHistoryItemSchema>;
export type InvoiceHistoryResponse = z.infer<
  typeof invoiceHistoryResponseSchema
>;
