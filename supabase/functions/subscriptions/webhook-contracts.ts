import { z } from "zod";
import { readLimitedText } from "../_shared/app/request-body.ts";

const paymentSchema = z.object({
  id: z.string().optional(),
  status: z.string().optional(),
  sequenceType: z.string().optional(),
  customerId: z.string().nullable().optional(),
  subscriptionId: z.string().nullable().optional(),
  paidAt: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  nextPaymentDate: z.string().nullable().optional(),
  amount: z.object({ currency: z.string(), value: z.string() }).optional(),
  metadata: z.object({
    org_id: z.string().optional(),
    plan: z.string().optional(),
    kind: z.string().optional(),
  }).passthrough().nullable().optional(),
  _links: z.object({
    subscription: z.object({ href: z.string() }).optional(),
    customer: z.object({ href: z.string() }).optional(),
  }).passthrough().optional(),
}).passthrough();

export const mollieWebhookResourceSchema = paymentSchema.extend({
  _embedded: z.record(z.string(), z.array(paymentSchema)).optional(),
});
export type MollieWebhookResource = z.infer<typeof mollieWebhookResourceSchema>;

export async function parseWebhookId(req: Request): Promise<string | null> {
  const text = await readLimitedText(req);
  let id: unknown;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const body = z.object({ id: z.unknown() }).safeParse(JSON.parse(text));
      id = body.success ? body.data.id : null;
    } catch {
      return null;
    }
  } else id = new URLSearchParams(text).get("id");
  const parsed = z.string().min(1).max(200).safeParse(id);
  return parsed.success ? parsed.data : null;
}
