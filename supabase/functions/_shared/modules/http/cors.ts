import type { HttpMethod } from "./types.ts";

const defaultAllowedHeaders = [
  "authorization",
  "x-client-info",
  "apikey",
  "content-type",
  "idempotency-key",
] as const;

const defaultAllowedMethods = [
  "GET",
  "POST",
  "PATCH",
  "PUT",
  "DELETE",
  "OPTIONS",
] satisfies readonly HttpMethod[];

export interface CorsConfig {
  allowedOrigins: ReadonlySet<string>;
  allowedHeaders?: readonly string[];
  allowedMethods?: readonly HttpMethod[];
  allowCredentials?: boolean;
  maxAgeSeconds?: number;
}

export function createCors(config: CorsConfig) {
  const allowedHeaders = config.allowedHeaders ?? defaultAllowedHeaders;
  const allowedMethods = config.allowedMethods ?? defaultAllowedMethods;
  const allowCredentials = config.allowCredentials ?? false;
  const maxAgeSeconds = config.maxAgeSeconds ?? 86_400;

  function getCorsHeaders(req: Request): Record<string, string> {
    const origin = req.headers.get("origin");
    const headers: Record<string, string> = {
      "Access-Control-Allow-Headers": allowedHeaders.join(", "),
      "Access-Control-Allow-Methods": allowedMethods.join(", "),
      "Access-Control-Max-Age": String(maxAgeSeconds),
      "Vary": "Origin",
    };

    if (origin && config.allowedOrigins.has(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;

      if (allowCredentials) {
        headers["Access-Control-Allow-Credentials"] = "true";
      }
    }

    return headers;
  }

  return { getHeaders: getCorsHeaders };
}
