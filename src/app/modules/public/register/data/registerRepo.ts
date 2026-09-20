import type { SupabaseClient } from "@supabase/supabase-js";

import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";

import {
  registerPayloadSchema,
  registerResponseSchema,
  type RegisterResponse,
} from "../schemas/public.registerPayload.schema";

export function createRegisterRepo(supabase: SupabaseClient) {
  return {
    async register(input: unknown): Promise<RegisterResponse> {
      const parsed = registerPayloadSchema.safeParse(input);

      if (!parsed.success) {
        throw new Error("INVALID_REGISTER_PAYLOAD");
      }

      const payload = parsed.data;

      const raw = await edgeSafe<unknown>(
        () =>
          supabase.functions.invoke("orders", {
            body: payload,
          }),
        "REGISTER_EMPTY_RESPONSE",
      );

      return registerResponseSchema.parse(raw);
    },
  };
}