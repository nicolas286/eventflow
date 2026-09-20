import {
  isRequestAuthenticationError,
  resolveSupabaseBearerUser,
} from "../../modules/supabase-auth/mod.ts";
import { createEdgeLogger, serializeError } from "../../modules/logger/mod.ts";
import { createServiceClient } from "../../modules/supabase-runtime/mod.ts";
import { handleCorsAndMethod, json } from "../http.ts";
import { createRequestSupabaseContext } from "../request-context.ts";
import { consumeRequestRateLimit } from "../rate-limit/mod.ts";
import type {
  EdgeAuthMode,
  EdgeHandler,
  EdgeHandlerContext,
  EdgeHandlerOptions,
} from "./types.ts";

export function createEdgeHandler<
  TAuth extends EdgeAuthMode,
  TServiceClient extends boolean = false,
>(
  options: EdgeHandlerOptions<TAuth, TServiceClient>,
  handler: EdgeHandler<TAuth, TServiceClient>,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const logger = createEdgeLogger(options.name);

    try {
      logger.info("request_received", {
        method: req.method,
        origin: req.headers.get("origin"),
      });

      const earlyResponse = handleCorsAndMethod(req, logger, options.method);
      if (earlyResponse) {
        if (earlyResponse.status === 405 && options.methodNotAllowedResponse) {
          return options.methodNotAllowedResponse(req);
        }
        return earlyResponse;
      }

      const requestContext = createRequestSupabaseContext(
        req,
        {
          ...options.requestContextOptions,
          useRequestAuthorization: options.auth !== "none",
        },
      );
      const user = options.auth === "none"
        ? null
        : await resolveSupabaseBearerUser(req, requestContext.authClient);

      if (options.auth === "required" && !user) {
        logger.warn("authentication_required");
        return options.authenticationRequiredResponse?.(req) ??
          json(req, { error: "UNAUTHORIZED" }, 401);
      }

      if (options.requireVerifiedEmail && user && !user.email_confirmed_at) {
        logger.warn("email_not_verified", { userId: user.id });
        return options.emailNotVerifiedResponse?.(req) ??
          json(req, { error: "EMAIL_NOT_VERIFIED" }, 403);
      }

      const serviceClient = options.serviceClient
        ? createServiceClient(requestContext.runtime)
        : null;
      if (options.rateLimit && serviceClient) {
        if (!user) throw new Error("User rate limit requires authentication");
        const rateLimit = await consumeRequestRateLimit({
          req,
          supabase: serviceClient,
          logger,
          key: `user:${user.id}`,
          scope: options.rateLimit.scope,
          limit: options.rateLimit.limit,
          windowSeconds: options.rateLimit.windowSeconds,
          salt: options.rateLimit.salt,
        });
        if (!rateLimit.allowed) return rateLimit.response;
      }

      const context = {
        req,
        logger,
        supabase: requestContext.supabase,
        user,
        ...(options.serviceClient ? { serviceClient } : {}),
      } as EdgeHandlerContext<TAuth, TServiceClient>;

      return await handler(context);
    } catch (error) {
      if (isRequestAuthenticationError(error)) {
        logger.warn("request_authentication_failed");
        return options.authenticationRequiredResponse?.(req) ??
          json(req, { error: "UNAUTHORIZED" }, 401);
      }

      if (options.onError) return await options.onError({ req, logger, error });

      logger.error("unhandled_edge_error", { error: serializeError(error) });
      return json(req, { error: "UNEXPECTED" }, 500);
    }
  };
}
