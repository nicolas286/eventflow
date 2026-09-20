import { getInvoicePdfUrlInputSchema } from "../../../shared/schemas/invoices.ts";
import { json } from "../_shared/app/http.ts";
import type { InvoicePdfUrlRepository } from "./repository.ts";

const SIGNED_URL_TTL_SECONDS = 120;
export async function handleGetInvoicePdfUrl(
  { req, repository }: {
    req: Request;
    repository: InvoicePdfUrlRepository;
  },
): Promise<Response> {
  const route = new URL(req.url).pathname.match(/\/invoices\/([^/]+)\/pdf$/);
  if (!route) return json(req, { error: "NOT_FOUND" }, 404);
  const parsed = getInvoicePdfUrlInputSchema.safeParse({ invoiceId: route[1] });
  if (!parsed.success) return json(req, { error: "invoice_id invalid" }, 400);
  const invoiceId = parsed.data.invoiceId;

  const invoiceResult = await repository.loadInvoice(invoiceId);

  if (invoiceResult.errorMessage) {
    return json(
      req,
      { error: "DB_ERROR", details: invoiceResult.errorMessage },
      500,
    );
  }

  const invoice = invoiceResult.data;
  if (!invoice) return json(req, { error: "NOT_FOUND" }, 404);
  if (!invoice.pdfPath) return json(req, { error: "PDF_NOT_READY" }, 409);

  const membershipResult = await repository.isOrganizationMember(invoice.orgId);

  if (membershipResult.errorMessage) {
    return json(
      req,
      {
        error: "MEMBERSHIP_CHECK_FAILED",
        details: membershipResult.errorMessage,
      },
      500,
    );
  }

  if (!membershipResult.data) return json(req, { error: "FORBIDDEN" }, 403);

  const signedUrlResult = await repository.createSignedUrl(
    invoice.pdfPath,
    SIGNED_URL_TTL_SECONDS,
  );

  if (signedUrlResult.errorMessage || !signedUrlResult.data) {
    return json(
      req,
      {
        error: "SIGN_FAILED",
        details: signedUrlResult.errorMessage ?? "no_signed_url",
      },
      500,
    );
  }

  return json(req, {
    url: signedUrlResult.data,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
}
