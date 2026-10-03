import { readPublicOrder } from "@gateways/supabase/repositories/readPublicOrder";
import type { WidgetOrderCredentials } from "../helpers/widgetConfirmation";

export function fetchWidgetConfirmationOrder(credentials: WidgetOrderCredentials, signal: AbortSignal) {
  return readPublicOrder(credentials.orderId, credentials.token, signal);
}
