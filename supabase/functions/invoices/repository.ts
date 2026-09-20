import type { SupabaseClient } from "@supabase/supabase-js";

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
}

export function createInvoicePdfUrlRepository(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
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
      const { data, error } = await userClient.rpc("is_org_member", {
        p_org_id: orgId,
      });

      return error
        ? { data: null, errorMessage: error.message }
        : { data: Boolean(data), errorMessage: null };
    },

    async createSignedUrl(path, expiresIn) {
      const { data, error } = await serviceClient.storage
        .from("invoices")
        .createSignedUrl(path, expiresIn);

      return error
        ? { data: null, errorMessage: error.message }
        : { data: data?.signedUrl ?? null, errorMessage: null };
    },
  };
}
