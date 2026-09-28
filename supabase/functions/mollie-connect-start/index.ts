import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";

export const handler = createEdgeHandler(
  { name: "mollie-connect-start", method: "POST", auth: "none" },
  ({ req }) =>
    Promise.resolve(json(req, { error: "MOLLIE_HISTORY_READ_ONLY" }, 410)),
);

if (import.meta.main) Deno.serve(handler);
