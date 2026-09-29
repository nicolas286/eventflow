import type { SupabaseClient } from "@supabase/supabase-js";
import { isRestrictedEnvironment } from "../_shared/environment-safety.ts";
import { generateInvoicePdf } from "../_shared/services/invoice-pdf/index.ts";
import { sendInvoiceToBillit } from "../_shared/services/billit/index.ts";

// The subscription/invoice transaction is already committed. External delivery
// must never turn that success into a misleading subscription-creation error.
export async function completeManualInvoiceDelivery(
  admin: SupabaseClient,
  invoiceId: string,
) {
  const warnings: string[] = [];
  try {
    const { data, error } = await admin.from("invoices").select("pdf_path")
      .eq("id", invoiceId).maybeSingle();
    if (error || !data) throw new Error("INVOICE_PDF_STATE_UNAVAILABLE");
    if (!data.pdf_path) {
      const result = await generateInvoicePdf(admin, invoiceId);
      if (result.error) warnings.push("INVOICE_PDF_PENDING");
    }
  } catch {
    warnings.push("INVOICE_PDF_PENDING");
  }

  try {
    if (!isRestrictedEnvironment()) {
      const result = await sendInvoiceToBillit(admin, invoiceId);
      if (
        result.data.reason === "review_required" ||
        result.data.error === "BILLIT_DELIVERY_UNKNOWN"
      ) {
        warnings.push("BILLIT_REVIEW_REQUIRED");
      } else if (
        result.error ||
        ["in_progress", "billit_not_configured"].includes(
          String(result.data.reason),
        )
      ) {
        warnings.push("BILLIT_SEND_PENDING");
      }
    }
  } catch {
    warnings.push("BILLIT_SEND_PENDING");
  }
  return warnings;
}
