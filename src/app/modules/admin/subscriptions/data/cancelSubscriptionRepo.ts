import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";

import {
  cancelSubscriptionPayloadSchema,
  cancelSubscriptionResponseSchema,
  type CancelSubscriptionPayload,
  type CancelSubscriptionResponse,
} from "../schemas/admin.cancelSubscription.schema";

export function createCancelSubscriptionRepo(supabase: { functions: Pick<SupabaseClient["functions"], "invoke"> }) {
  return {
    async cancelSubscription(
      input: CancelSubscriptionPayload,
    ): Promise<CancelSubscriptionResponse> {
      const payload = cancelSubscriptionPayloadSchema.parse(input);

      const raw = await edgeSafe(
        () =>
          supabase.functions.invoke(`subscriptions/${payload.orgId}`, {
            method: "DELETE",
          }),
        "CANCEL_SUBSCRIPTION_EMPTY_RESPONSE"
      );

      return cancelSubscriptionResponseSchema.parse(raw);
    },
  };
}
