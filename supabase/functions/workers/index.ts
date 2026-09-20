import { expireOrders } from "./expire-orders.ts";
import { migrateSubscriptionWebhooks } from "./migrate-subscription-webhooks.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { assertInternalEdgeAuthentication } from "../_shared/app/internal-edge/mod.ts";
import { ResponseError } from "../_shared/errors.ts";
import { serializeError } from "../_shared/modules/logger/mod.ts";
import { resolveRuntimeConfig } from "../_shared/services/order-reminders/config.ts";
import { parseSendReminderMailPayload } from "../_shared/services/order-reminders/sendReminderMail.contracts.ts";
import {
  runCron,
  runManual,
} from "../_shared/services/order-reminders/index.ts";
export const handleSendReminderMailRequest = createEdgeHandler(
  {
    name: "workers/reminders",
    method: "POST",
    auth: "none",
    serviceClient: true,
    onError: ({ req, logger, error }) => {
      if (error instanceof ResponseError) {
        logger.warn("response_error", {
          code: error.code,
          status: error.status,
        });
        return json(req, { error: error.code }, error.status);
      }

      logger.error("unexpected_error", { error: serializeError(error) });
      return json(req, { error: "UNEXPECTED_ERROR" }, 500);
    },
  },
  async ({ req, logger, serviceClient: admin }) => {
    if (
      new URL(req.url).pathname.endsWith(
        "/workers/migrate-subscription-webhooks",
      )
    ) {
      return migrateSubscriptionWebhooks(req, admin);
    }
    if (new URL(req.url).pathname.endsWith("/workers/expire-orders")) {
      return expireOrders(req, admin);
    }
    if (!new URL(req.url).pathname.endsWith("/workers/reminders")) {
      return json(req, { error: "NOT_FOUND" }, 404);
    }
    const config = resolveRuntimeConfig();
    const authenticationSource = await assertInternalEdgeAuthentication(
      req,
      config.edgeServiceToken,
      { allowLegacyServiceToken: true },
    );
    logger.info("worker_authenticated", { source: authenticationSource });

    const payload = await parseSendReminderMailPayload(req);

    if (payload.kind === "manual") {
      const result = await runManual({
        admin,
        appBaseUrl: config.appBaseUrl,
        orderId: payload.data.orderId,
        debug: payload.data.debug,
        logger,
      });

      return json(req, {
        ok: true,
        mode: "manual",
        ...result,
      });
    }

    const result = await runCron({
      admin,
      appBaseUrl: config.appBaseUrl,
      logger,
    });

    return json(req, {
      ok: true,
      mode: "cron",
      ...result,
    });
  },
);

if (import.meta.main) Deno.serve(handleSendReminderMailRequest);
