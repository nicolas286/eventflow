import { orderPublicSchema } from "@contracts/orders-read";
import type { WidgetOrderCredentials } from "../helpers/widgetConfirmation";

export async function fetchWidgetConfirmationOrder(
  credentials: WidgetOrderCredentials,
  signal: AbortSignal,
) {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/orders/${encodeURIComponent(credentials.orderId)}?token=${encodeURIComponent(credentials.token)}`,
    {
      signal,
      cache: "no-store",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
    },
  );
  if (!response.ok) throw new Error("order_fetch_failed");

  const order = orderPublicSchema.parse(await response.json());
  if (order.id !== credentials.orderId) throw new Error("order_mismatch");
  return order;
}
