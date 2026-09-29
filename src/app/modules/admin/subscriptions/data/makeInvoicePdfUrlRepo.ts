import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";
import { getInvoicePdfUrlInputSchema, getInvoicePdfUrlResponseSchema, type GetInvoicePdfUrlInput, type GetInvoicePdfUrlResponse } from "@contracts/invoices";
export type { GetInvoicePdfUrlInput, GetInvoicePdfUrlResponse } from "@contracts/invoices";

export function invoicePdfRepo(supabase: SupabaseClient) {
  return {
    async getPdfUrl(input: GetInvoicePdfUrlInput): Promise<GetInvoicePdfUrlResponse> {
      const payload = getInvoicePdfUrlInputSchema.parse(input);

      const raw = await edgeSafe(
        () =>
          supabase.functions.invoke(`invoices/${payload.invoiceId}/pdf`, { method: "GET" }),
        "GET_INVOICE_PDF_URL_EMPTY_RESPONSE"
      );

      return getInvoicePdfUrlResponseSchema.parse(raw);
    },
  };
}