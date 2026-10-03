import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { productDeleteRequestSchema, productDeleteResponseSchema, type DeleteEventProductInput } from "@contracts/event-products";

export function deleteEventProductRepo(supabase: SupabaseClient) {
  return {
    async deleteEventProduct(input: DeleteEventProductInput): Promise<void> {
      const body = productDeleteRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/products/delete", { body }));
      productDeleteResponseSchema.parse(raw);
    },
  };
}
