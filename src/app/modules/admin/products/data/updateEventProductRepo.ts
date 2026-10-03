import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  productUpdatePatchSchema, productUpdateRequestSchema, productReadRequestSchema,
  eventProductSchema, type EventProduct, type UpdateEventProductPatch,
} from "@contracts/event-products";
export type { UpdateEventProductPatch } from "@contracts/event-products";
const updateOrReadRequestSchema = productReadRequestSchema.extend({ patch: productUpdatePatchSchema }).strict();

export function updateEventProductRepo(supabase: SupabaseClient) {
  return {
    async updateEventProduct(input: { productId: string; patch: UpdateEventProductPatch }): Promise<EventProduct> {
      const parsed = updateOrReadRequestSchema.parse(input);
      const patch = Object.fromEntries(Object.entries(parsed.patch).filter(([, value]) => value !== undefined));
      const reading = Object.keys(patch).length === 0;
      const body = reading
        ? productReadRequestSchema.parse({ productId: parsed.productId })
        : productUpdateRequestSchema.parse({ productId: parsed.productId, patch });
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke(
        reading ? "events/products/read" : "events/products/update", { body }
      ));
      return eventProductSchema.parse(raw);
    },
  };
}
