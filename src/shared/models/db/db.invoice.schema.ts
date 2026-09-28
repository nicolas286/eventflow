import { z } from "zod";

export const invoiceStatusSchema = z.enum(["draft", "issued", "paid", "void"]);

export const invoiceSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),

  number: z
    .string()
    .min(3, "Le numéro de facture est trop court")
    .max(40, "Le numéro de facture est trop long")
    .transform((s) => s.trim()),

  status: invoiceStatusSchema,

  issuedAt: z.string().optional().nullable(),
  paidAt: z.string().optional().nullable(),
  dueAt: z.string().optional().nullable(),
  paymentReference: z.string().max(80).optional().nullable(),
  periodStart: z.string().optional().nullable(),
  periodEnd: z.string().optional().nullable(),

  currency: z.string().length(3, "Le code devise doit faire 3 caractères"),

  subtotalCents: z
    .number()
    .int()
    .min(0, "Le sous-total doit être positif ou nul")
    .max(100000000, "Montant trop élevé"),
  vatCents: z
    .number()
    .int()
    .min(0, "La TVA doit être positive ou nulle")
    .max(100000000, "Montant trop élevé"),
  totalCents: z
    .number()
    .int()
    .min(0, "Le total doit être positif ou nul")
    .max(100000000, "Montant trop élevé"),

  vatRate: z.number().min(0).max(100).optional().nullable(),

  provider: z.string().max(30, "Provider trop long").optional().nullable(),
  molliePaymentId: z
    .string()
    .max(80, "Id Mollie trop long")
    .optional()
    .nullable(),
  mollieSubscriptionId: z
    .string()
    .max(80, "Id subscription Mollie trop long")
    .optional()
    .nullable(),

  pdfPath: z.string().max(300, "Chemin PDF trop long").optional().nullable(),

  createdAt: z.string(),
  updatedAt: z.string(),
});

export const invoicesSchema = z.array(invoiceSchema);

/**
 * Version UI:
 * - on ne montre pas les ids provider par défaut (tu peux faire un écran debug)
 */
export const invoiceUISchema = invoiceSchema.omit({
  provider: true,
  molliePaymentId: true,
  mollieSubscriptionId: true,
});

export const invoicesUISchema = z.array(invoiceUISchema);

/**
 * RPC response for rpc_list_invoices:
 * { orgId, items: Invoice[], nextCursor: { issuedAt, id } | null }
 */
export const invoicesListResponseSchema = z.object({
  orgId: z.uuid(),
  items: invoicesSchema,
  nextCursor: z
    .object({
      issuedAt: z.string().nullable(), // issuedAt may be null (rare), matching SQL order nulls last
      id: z.uuid(),
    })
    .nullable(),
});

export const invoicesListResponseUISchema = invoicesListResponseSchema.extend({
  items: invoicesUISchema,
});

export type Invoice = z.infer<typeof invoiceSchema>;
export type InvoiceUI = z.infer<typeof invoiceUISchema>;
export type Invoices = z.infer<typeof invoicesSchema>;
export type InvoicesUI = z.infer<typeof invoicesUISchema>;
export type InvoicesListResponse = z.infer<typeof invoicesListResponseSchema>;
export type InvoicesListResponseUI = z.infer<
  typeof invoicesListResponseUISchema
>;
