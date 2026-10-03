import { invoiceHistoryRequestSchema } from "../../../shared/schemas/invoice-history.ts";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { badRequest, ResponseError } from "../_shared/errors.ts";
import { assertOrganizationManager } from "../_shared/organization-access.ts";
import { createInvoiceHistoryRepository } from "./history-repository.ts";

export const handleInvoiceHistoryRequest = createEdgeHandler({
  name: "invoices-history",
  method: "POST",
  auth: "required",
  serviceClient: true,
  onError: ({ req, logger, error }) => {
    if (error instanceof BodyTooLargeError) {
      return json(req, { error: "PAYLOAD_TOO_LARGE" }, 413);
    }
    if (error instanceof SyntaxError) {
      return json(req, { error: "INVALID_JSON" }, 400);
    }
    if (error instanceof ResponseError) {
      return json(req, { error: error.code }, error.status);
    }
    logger.error("invoice_history_failed", { code: "UNEXPECTED_ERROR" });
    return json(req, { error: "UNEXPECTED_ERROR" }, 500);
  },
}, async ({ req, user, serviceClient, logger }) => {
  const parsed = invoiceHistoryRequestSchema.safeParse(
    await readLimitedJson(req, 4096),
  );
  if (!parsed.success) throw badRequest("VALIDATION_ERROR");
  const input = parsed.data;
  await assertOrganizationManager(serviceClient, input.orgId, user.id);
  const quota = await consumeRequestRateLimit({
    req,
    supabase: serviceClient,
    logger,
    key: `user:${user.id}:org:${input.orgId.toLowerCase()}`,
    scope: "invoices:history:1m",
    limit: 120,
    windowSeconds: 60,
  });
  if (!quota.allowed) return quota.response;
  return json(
    req,
    await createInvoiceHistoryRepository(serviceClient).list(input),
  );
});
