import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { serializeError } from "../_shared/modules/logger/mod.ts";
import { handleGetInvoicePdfUrl } from "./handler.ts";
import { createInvoicePdfUrlRepository } from "./repository.ts";

export const handleGetInvoicePdfUrlRequest = createEdgeHandler(
  {
    name: "get-invoice-pdf-url",
    method: "POST",
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
  ({ req, supabase, serviceClient }) =>
    handleGetInvoicePdfUrl({
      req,
      repository: createInvoicePdfUrlRepository(supabase, serviceClient),
    }),
);

Deno.serve(handleGetInvoicePdfUrlRequest);
