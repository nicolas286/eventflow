import { ResponseError } from "../_shared/errors.ts";
import {
  createEdgeLogger,
  serializeError,
} from "../_shared/modules/logger/mod.ts";
import { json } from "./http.ts";
import { handleManualStartSubscription } from "./manual.ts";

const logger = createEdgeLogger("subscriptions-start");

export async function startSubscription(req: Request): Promise<Response> {
  try {
    return await handleManualStartSubscription(req);
  } catch (error) {
    logger.error("manual_subscription_start_failed", {
      error: serializeError(error),
    });
    if (error instanceof ResponseError) {
      return json(req, { error: error.code }, error.status);
    }
    return json(req, { error: "SUBSCRIPTION_START_FAILED" }, 500);
  }
}
