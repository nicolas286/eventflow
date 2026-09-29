import { z } from "zod";
import { bookingTokenSchema, orderIdSchema } from "@contracts/orders-read";

const cachedConfirmationSchema = z.object({
  orderId: orderIdSchema,
  bookingToken: bookingTokenSchema.nullable().optional(),
  eventTitle: z.string(),
  buyerEmail: z.string(),
  totalTickets: z.number().int().nonnegative(),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().int().nonnegative(),
    totalCents: z.number().int().nonnegative(),
    currency: z.string().length(3),
  })).optional(),
});

export type CachedWidgetConfirmation = z.infer<typeof cachedConfirmationSchema>;
export type WidgetOrderCredentials = { orderId: string; token: string };

export function readCachedWidgetConfirmation(raw: string | null): CachedWidgetConfirmation | null {
  if (!raw) return null;
  try {
    const result = cachedConfirmationSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function resolveWidgetOrderCredentials(
  orderIdFromUrl: string | null,
  tokenFromUrl: string | null,
  cached: CachedWidgetConfirmation | null,
): WidgetOrderCredentials | null {
  // An incomplete URL must never borrow credentials from another cached order.
  const hasUrlCredentials = orderIdFromUrl !== null || tokenFromUrl !== null;
  const orderId = orderIdSchema.safeParse(hasUrlCredentials ? orderIdFromUrl : cached?.orderId);
  const token = bookingTokenSchema.safeParse(hasUrlCredentials ? tokenFromUrl : cached?.bookingToken);
  return orderId.success && token.success ? { orderId: orderId.data.toLowerCase(), token: token.data } : null;
}
