import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";
import {
  stripeConnectInputSchema,
  stripeConnectStartResultSchema,
  stripeConnectStatusResultSchema,
  type StripeConnectInput,
  type StripeConnectStatus,
} from "../schemas/admin.stripeConnect.schema";

export function stripeConnectRepo(supabase: SupabaseClient) {
  return {
    async start(input: StripeConnectInput) {
      const payload = stripeConnectInputSchema.parse(input);
      const raw = await edgeSafe(
        () =>
          supabase.functions.invoke("stripe-connect-start", { body: payload }),
        "STRIPE_CONNECT_START_EMPTY_RESPONSE",
      );
      return stripeConnectStartResultSchema.parse(raw);
    },

    async status(input: StripeConnectInput): Promise<StripeConnectStatus> {
      const payload = stripeConnectInputSchema.parse(input);
      const raw = await edgeSafe(
        () =>
          supabase.functions.invoke("stripe-connect-status", { body: payload }),
        "STRIPE_CONNECT_STATUS_EMPTY_RESPONSE",
      );
      return stripeConnectStatusResultSchema.parse(raw);
    },
  };
}
