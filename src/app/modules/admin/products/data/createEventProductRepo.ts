import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import { productCreateRequestSchema, eventProductSchema, type CreateEventProductInput, type EventProduct } from "@contracts/event-products";

export function createEventProductRepo(supabase: SupabaseClient) {
  return {
    async createEventProduct(input: CreateEventProductInput): Promise<EventProduct> {
      const body = productCreateRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/products/create", { body }));
      return eventProductSchema.parse(raw);
    },
  };
}
