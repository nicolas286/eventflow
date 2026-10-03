import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  promoListRequestSchema, promoCreateRequestSchema, promoUpdateRequestSchema,
  promoUpdateOrReadRequestSchema, promoReadRequestSchema, promoDeleteRequestSchema,
  promoMutationSuccessSchema, promoCodeSchema,
  type DbPromoCode, type CreatePromoCodeInput, type UpdatePromoCodePatch, type DeletePromoCodeInput,
} from "@contracts/promo-codes";
const promoListResponseSchema = z.array(promoCodeSchema);

export function adminPromoCodesRepo(supabase: SupabaseClient) {
  return {
    async listEventPromoCodes(input: { eventId: string }): Promise<DbPromoCode[]> {
      const body = promoListRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/promos/list", { body }));
      return promoListResponseSchema.parse(raw);
    },
    async createPromoCode(input: CreatePromoCodeInput): Promise<DbPromoCode> {
      const body = promoCreateRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/promos/create", { body }));
      return promoCodeSchema.parse(raw);
    },
    async updatePromoCode(input: { promoCodeId: string; patch: UpdatePromoCodePatch }): Promise<DbPromoCode> {
      const parsed = promoUpdateOrReadRequestSchema.parse(input);
      const patch = Object.fromEntries(Object.entries(parsed.patch).filter(([, value]) => value !== undefined));
      const reading = Object.keys(patch).length === 0;
      const body = reading
        ? promoReadRequestSchema.parse({ promoCodeId: parsed.promoCodeId })
        : promoUpdateRequestSchema.parse({ promoCodeId: parsed.promoCodeId, patch });
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke(
        reading ? "events/promos/read" : "events/promos/update", { body },
      ));
      return promoCodeSchema.parse(raw);
    },
    async deletePromoCode(input: DeletePromoCodeInput): Promise<void> {
      const body = promoDeleteRequestSchema.parse(input);
      const raw = await edgeSafe<unknown>(() => supabase.functions.invoke("events/promos/delete", { body }));
      promoMutationSuccessSchema.parse(raw);
    },
  };
}
