import { z } from "zod";
export const getInvoicePdfUrlInputSchema = z.object({
  invoiceId: z.string().uuid(),
});
export const getInvoicePdfUrlResponseSchema = z.object({
  url: z.string().url().max(8192),
  expiresIn: z.number().int().positive(),
});
export type GetInvoicePdfUrlInput = z.infer<typeof getInvoicePdfUrlInputSchema>;
export type GetInvoicePdfUrlResponse = z.infer<
  typeof getInvoicePdfUrlResponseSchema
>;
