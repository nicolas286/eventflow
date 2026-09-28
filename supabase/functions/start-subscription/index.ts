import { handleManualStartSubscription } from "./manual.ts";
import { json } from "./http.ts";
import { ResponseError } from "../_shared/errors.ts";
import { createEdgeLogger, serializeError } from "../_shared/logger.ts";

const logger = createEdgeLogger("start-subscription");

Deno.serve(async (req) => {
  try {
    return await handleManualStartSubscription(req);
  } catch (error) {
    logger.error("manual_subscription_start_failed", serializeError(error));
    if (error instanceof ResponseError) {
      return json(req, { error: error.code }, error.status);
    }
    return json(req, { error: "SUBSCRIPTION_START_FAILED" }, 500);
  }
});
