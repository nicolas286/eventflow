import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { applicationRateLimits } from "../_shared/app/config/rate-limits.ts";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import { json } from "../_shared/app/http.ts";
import { serializeError } from "../_shared/modules/logger/mod.ts";
import { handleGetInvoicePdfUrl } from "./handler.ts";
import { createInvoicePdfUrlRepository } from "./repository.ts";
import { handleInvoiceHistoryRequest } from "./history.ts";

export const handleGetInvoicePdfUrlRequest = createEdgeHandler(
  {
    name: "invoices",
    method: "GET",
    auth: "required",
    serviceClient: true,
    authenticationRequiredResponse: (req) =>
      json(req, { error: "UNAUTHORIZED" }, 401),
    methodNotAllowedResponse: (req) =>
      json(req, { error: "Method not allowed" }, 405),
    onError: ({ req, logger, error }) => {
      logger.error("unexpected_error", { error: serializeError(error) });
      return json(req, { error: "UNEXPECTED" }, 500);
    },
  },
  ({ req, serviceClient, user, logger }) =>
    handleGetInvoicePdfUrl({
      req,
      repository: createInvoicePdfUrlRepository(serviceClient, user.id),
      consumeAuthorizedQuota: async (orgId) => {
        const quota = await consumeRequestRateLimit({
          req, supabase: serviceClient, logger, key: `user:${user.id}:org:${orgId}`,
          ...applicationRateLimits.invoicePdf,
        });
        return quota.allowed ? null : quota.response;
      },
    }),
);

export function handleInvoicesRequest(req: Request): Promise<Response> {
  if (new URL(req.url).pathname.endsWith("/invoices/list")) {
    return handleInvoiceHistoryRequest(req);
  }
  return handleGetInvoicePdfUrlRequest(req);
}

if (import.meta.main) Deno.serve(handleInvoicesRequest);
