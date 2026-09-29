import type { JsonResponder } from "./json-response.ts";
import type { AllowedMethods, HttpMethod, LoggerLike } from "./types.ts";

interface RequestGuardDependencies {
  getCorsHeaders: (req: Request) => Record<string, string>;
  json: JsonResponder;
}

export function createRequestGuard(dependencies: RequestGuardDependencies) {
  return function handleCorsAndMethod(
    req: Request,
    logger: LoggerLike,
    allowedMethods: AllowedMethods = "POST",
  ): Response | null {
    const methods: readonly HttpMethod[] = Array.isArray(allowedMethods)
      ? allowedMethods
      : [allowedMethods];

    if (req.method === "OPTIONS") {
      logger.info("options_preflight", {
        origin: req.headers.get("origin"),
        requestedMethod: req.headers.get("access-control-request-method"),
        allowedMethods: methods,
      });

      return new Response(null, {
        status: 204,
        headers: dependencies.getCorsHeaders(req),
      });
    }

    if (!methods.includes(req.method as HttpMethod)) {
      logger.warn("method_not_allowed", {
        method: req.method,
        allowedMethods: methods,
      });

      return dependencies.json(
        req,
        { error: "METHOD_NOT_ALLOWED", allowedMethods: methods },
        405,
      );
    }

    return null;
  };
}
