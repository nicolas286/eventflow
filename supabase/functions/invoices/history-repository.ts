import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type InvoiceHistoryRequest,
  invoiceHistoryResponseSchema,
} from "../../../shared/schemas/invoice-history.ts";
import { forbidden, internal } from "../_shared/errors.ts";

const rowSchema = z.object({
  id: z.uuid(),
  number: z.string(),
  status: z.enum(["draft", "issued", "paid", "void"]),
  issued_at: z.iso.datetime({ offset: true }).nullable(),
  total_cents: z.number().int().nonnegative(),
  due_at: z.iso.datetime({ offset: true }).nullable(),
  payment_reference: z.string().max(80).nullable(),
});

export function createInvoiceHistoryRepository(serviceClient: SupabaseClient) {
  return {
    // Call only after the Edge has authorized orgId for the verified actor.
    async list(input: InvoiceHistoryRequest) {
      let authorizedCursor = input.cursor;
      if (input.cursor) {
        const { data, error } = await serviceClient.from("invoices")
          .select("id, issued_at").eq("org_id", input.orgId)
          .eq("id", input.cursor.id).maybeSingle();
        if (error) throw internal("INVOICE_HISTORY_LOAD_FAILED");
        const cursorRow = z.object({
          id: z.uuid(),
          issued_at: z.iso.datetime({ offset: true }).nullable(),
        }).safeParse(data);
        if (
          !cursorRow.success ||
          (cursorRow.data.issued_at === null
            ? input.cursor.issuedAt !== null
            : input.cursor.issuedAt === null ||
              Date.parse(cursorRow.data.issued_at) !==
                Date.parse(input.cursor.issuedAt))
        ) {
          // Do not look up a foreign invoice to explain the refusal.
          throw forbidden();
        }
        // Use the database timestamp for filtering, including sub-millisecond
        // precision. The client's timestamp is only a consistency check.
        authorizedCursor = {
          id: cursorRow.data.id,
          issuedAt: cursorRow.data.issued_at,
        };
      }

      let query = serviceClient.from("invoices")
        .select(
          "id, number, status, issued_at, total_cents, due_at, payment_reference",
        )
        .eq("org_id", input.orgId)
        .order("issued_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false }).limit(input.limit);
      if (authorizedCursor) {
        const { issuedAt, id } = authorizedCursor;
        query = issuedAt === null
          ? query.is("issued_at", null).lt("id", id)
          : query.or(
            `issued_at.lt.${issuedAt},and(issued_at.eq.${issuedAt},id.lt.${id}),issued_at.is.null`,
          );
      }
      const { data, error } = await query;
      if (error) throw internal("INVOICE_HISTORY_LOAD_FAILED");
      const parsed = z.array(rowSchema).safeParse(data);
      if (!parsed.success) throw internal("INVOICE_HISTORY_RESPONSE_INVALID");
      const rows = parsed.data;
      const last = rows.at(-1);
      return invoiceHistoryResponseSchema.parse({
        orgId: input.orgId,
        items: rows.map((row) => ({
          id: row.id,
          number: row.number,
          status: row.status,
          issuedAt: row.issued_at,
          totalCents: row.total_cents,
          dueAt: row.due_at,
          paymentReference: row.payment_reference,
        })),
        nextCursor: last && rows.length === input.limit
          ? { issuedAt: last.issued_at, id: last.id }
          : null,
      });
    },
  };
}
