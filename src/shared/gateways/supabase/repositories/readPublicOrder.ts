import { orderPublicSchema, type OrderPublicResponse } from "@contracts/orders-read";
import { readEdgeRequestError } from "@errors/edgeRequestError";

export async function readPublicOrder(
  orderId: string,
  token: string,
  signal?: AbortSignal,
): Promise<OrderPublicResponse> {
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/orders/${encodeURIComponent(orderId)}?token=${encodeURIComponent(token)}`,
    {
      signal,
      cache: "no-store",
      headers: {
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
    },
  );
  if (!response.ok) throw await readEdgeRequestError(response) ?? new Error("order_fetch_failed");
  const order = orderPublicSchema.parse(await response.json());
  if (order.id !== orderId) throw new Error("order_mismatch");
  return { ...order, status: order.status === "cancelled" ? "canceled" : order.status };
}
