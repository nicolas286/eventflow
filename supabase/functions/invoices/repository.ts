import { assertOrganizationManager } from "../_shared/organization-access.ts";
import { ResponseError } from "../_shared/errors.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateInvoicePdf } from "../_shared/services/invoice-pdf/index.ts";

export type InvoicePdfRecord = {
  id: string;
  orgId: string;
  pdfPath: string | null;
};

export type RepositoryResult<T> =
  | { data: T; errorMessage: null }
  | { data: null; errorMessage: string };

export interface InvoicePdfUrlRepository {
  loadInvoice(
    invoiceId: string,
  ): Promise<RepositoryResult<InvoicePdfRecord | null>>;
  isOrganizationMember(orgId: string): Promise<RepositoryResult<boolean>>;
  createSignedUrl(
    path: string,
    expiresIn: number,
  ): Promise<RepositoryResult<string | null>>;
  generatePdf(invoiceId: string): Promise<RepositoryResult<string | null>>;
}

export function createInvoicePdfUrlRepository(
  serviceClient: SupabaseClient,
  actorId: string,
): InvoicePdfUrlRepository {
  return {
    async loadInvoice(invoiceId) {
      const { data, error } = await serviceClient
        .from("invoices")
        .select("id, org_id, pdf_path")
        .eq("id", invoiceId)
        .maybeSingle();

      if (error) return { data: null, errorMessage: error.message };
      if (!data?.id) return { data: null, errorMessage: null };

      return {
        data: {
          id: String(data.id),
          orgId: String(data.org_id),
          pdfPath: typeof data.pdf_path === "string" ? data.pdf_path : null,
        },
        errorMessage: null,
      };
    },

    async isOrganizationMember(orgId) {
      try {
        await assertOrganizationManager(serviceClient, orgId, actorId);
        return { data: true, errorMessage: null };
      } catch (error: unknown) {
        if (error instanceof ResponseError && error.status === 403) {
          return { data: false, errorMessage: null };
        }
        return { data: null, errorMessage: "MEMBERSHIP_LOOKUP_FAILED" };
      }
    },

    async createSignedUrl(path, expiresIn) {
      const { data, error } = await serviceClient.storage
        .from("invoices")
        .createSignedUrl(path, expiresIn);

      return error
        ? { data: null, errorMessage: error.message }
        : { data: data?.signedUrl ?? null, errorMessage: null };
    },

    async generatePdf(invoiceId) {
      const generated = await generateInvoicePdf(serviceClient, invoiceId);
      if (generated.error) {
        return { data: null, errorMessage: generated.error.message };
      }

      const refreshed = await this.loadInvoice(invoiceId);
      if (refreshed.errorMessage) return refreshed;
      return {
        data: refreshed.data?.pdfPath ?? null,
        errorMessage: null,
      };
    },
  };
}
