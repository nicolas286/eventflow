import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../_shared/modules/logger/types.ts";
import { completeManualInvoiceDelivery } from "../subscriptions/invoice-delivery.ts";

const AUTOMATIC_DELIVERY_START = "2026-11-01T00:00:00+01:00";

export async function deliverPendingManualSubscriptionInvoices(
  admin: SupabaseClient,
  logger: EdgeLogger,
) {
  const { data: invoices, error } = await admin
    .from("invoices")
    .select("id, invoice_peppol!inner(status)")
    .eq("provider", "manual")
    .gte("issued_at", AUTOMATIC_DELIVERY_START)
    .eq("invoice_peppol.status", "not_sent")
    .order("issued_at", { ascending: true })
    .limit(10);

  if (error) throw new Error("MANUAL_INVOICE_DELIVERY_LOAD_FAILED");

  let processed = 0;
  for (const invoice of invoices ?? []) {
    const invoiceId = String(invoice.id ?? "");
    if (!invoiceId) continue;
    const warnings = await completeManualInvoiceDelivery(admin, invoiceId);
    logger.info("manual_invoice_delivery_processed", {
      invoiceId,
      warnings,
    });
    processed += 1;
  }
  return processed;
}
