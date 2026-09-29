import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";

import {
  startSubscriptionPayloadSchema,
  startSubscriptionResponseSchema,
  type StartSubscriptionPayload,
  type StartSubscriptionResponse,
} from "../schemas/admin.startSubscription.schema";

export function createStartSubscriptionRepo(supabase: { functions: Pick<SupabaseClient["functions"], "invoke"> }) {
  return {
    async startSubscription(
      input: StartSubscriptionPayload,
    ): Promise<StartSubscriptionResponse> {
      const payload = startSubscriptionPayloadSchema.parse(input);

      const raw = await edgeSafe(
        () =>
          supabase.functions.invoke("subscriptions", {
            body: payload,
          }),
        "START_SUBSCRIPTION_EMPTY_RESPONSE"
      );

      return startSubscriptionResponseSchema.parse(raw);
    },
  };
}
