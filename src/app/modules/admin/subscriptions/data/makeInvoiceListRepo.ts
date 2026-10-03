import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { EdgeRequestError } from "@errors/edgeRequestError";
import {
  invoiceHistoryRequestSchema,
  invoiceHistoryResponseSchema,
  type InvoiceHistoryRequest,
  type InvoiceHistoryResponse,
} from "@contracts/invoice-history";

export function makeInvoiceListRepo(supabase: SupabaseClient) {
  return {
    async listInvoices(params: InvoiceHistoryRequest): Promise<InvoiceHistoryResponse> {
      const body = invoiceHistoryRequestSchema.parse(params);
      let raw: unknown;
      try {
        raw = await edgeSafe<unknown>(() => supabase.functions.invoke("invoices/list", { body }));
      } catch (error) {
        if (error instanceof EdgeRequestError) throw error;
        if (error instanceof Error && error.message === "FORBIDDEN") throw error;
        if (error instanceof Error && error.message === "UNAUTHORIZED") {
          throw new Error("Tu dois être connecté pour consulter les factures.");
        }
        throw new Error("Impossible de charger les factures. Réessayez dans quelques instants.");
      }
      const result = invoiceHistoryResponseSchema.parse(raw);
      if (result.orgId !== body.orgId) throw new Error("FORBIDDEN");
      return result;
    },
  };
}
