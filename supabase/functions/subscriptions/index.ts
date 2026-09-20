import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";
import { cancelSubscription } from "./cancel.ts";
import { handleFirstPayment } from "./first-payment.ts";
import { handleRecurringPayment } from "./recurring-payment.ts";
import { startSubscription } from "./start.ts";

// Each operation retains its own session/organization or Mollie verification.
export const handler = createEdgeHandler(
  { name: "subscriptions", method: ["POST", "DELETE"], auth: "none" },
  async ({ req }) => {
    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const path = parts.slice(parts.indexOf("subscriptions") + 1);
    if (req.method === "POST" && path.length === 0) {
      return await startSubscription(req);
    }
    if (req.method === "DELETE" && path.length === 1) {
      return await cancelSubscription(req, path[0]);
    }
    if (req.method === "POST" && path.join("/") === "webhooks/first-payment") {
      return await handleFirstPayment(req);
    }
    if (
      req.method === "POST" && path.join("/") === "webhooks/recurring-payment"
    ) {
      return await handleRecurringPayment(req);
    }
    return json(req, { error: "NOT_FOUND" }, 404);
  },
);

if (import.meta.main) Deno.serve(handler);
