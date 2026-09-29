import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { accountRateLimits } from "../_shared/app/config/rate-limits.ts";
import { json } from "../_shared/app/http.ts";
import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";
import { deleteAccountInputSchema } from "../../../shared/schemas/accounts.ts";
import { deleteAccount } from "./delete-account.ts";

const MAX_BODY_BYTES = 16_384;

export const handler = createEdgeHandler(
  {
    name: "accounts",
    method: "DELETE",
    auth: "required",
    serviceClient: true,
    rateLimit: {
      ...accountRateLimits.deletion,
      key: "user",
    },
    authenticationRequiredResponse: (req) =>
      json(
        req,
        {
          error: req.headers.get("authorization")
            ? "Invalid session"
            : "Missing Authorization bearer token",
        },
        401,
      ),
    onError: ({ req, logger, error }) => {
      if (error instanceof BodyTooLargeError) {
        return json(req, { error: "PAYLOAD_TOO_LARGE" }, 413);
      }
      if (error instanceof SyntaxError) {
        return json(req, { error: "Invalid payload" }, 400);
      }
      logger.error("account_deletion_failed", { error });
      return json(req, { error: "Unexpected error" }, 500);
    },
  },
  async ({ req, user, serviceClient, logger }) => {
    if (!new URL(req.url).pathname.endsWith("/accounts/me")) {
      return json(req, { error: "Not found" }, 404);
    }

    const parsed = deleteAccountInputSchema.safeParse(
      await readLimitedJson(req, MAX_BODY_BYTES),
    );
    if (!parsed.success) {
      return json(req, { error: "Invalid payload" }, 400);
    }

    const result = await deleteAccount({
      service: serviceClient,
      logger,
      userId: user.id,
      requestedOrgId: parsed.data.orgId,
    });
    return json(req, result.body, result.status);
  },
);

if (import.meta.main) Deno.serve(handler);
