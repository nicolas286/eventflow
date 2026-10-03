import { json } from "../http.ts";
import {
  consumeRateLimit,
  hashRateLimitKey,
} from "../../modules/supabase-rate-limit/mod.ts";
import type {
  ConsumeRequestRateLimitInput,
  RequestRateLimitResult,
} from "./types.ts";
import type { RateLimitResult } from "../../modules/supabase-rate-limit/mod.ts";

export async function consumeRequestRateLimit({
  req,
  supabase,
  logger,
  key,
  scope,
  limit,
  windowSeconds,
  salt: providedSalt,
}: ConsumeRequestRateLimitInput): Promise<RequestRateLimitResult> {
  if (!key.trim()) throw new Error("Rate limit key is required");

  let keyHash: string;
  let rateLimit: RateLimitResult;
  try {
    const salt = providedSalt ?? Deno.env.get("RATE_LIMIT_SALT");
    if (!salt?.trim()) throw new Error("RATE_LIMIT_SALT is not configured");
    keyHash = await hashRateLimitKey(key, salt);
    rateLimit = await consumeRateLimit({
      supabase,
      keyHash,
      scope,
      limit,
      windowSeconds,
    });
  } catch {
    // Never log RPC errors: they may contain a key or request details.
    logger.error("rate_limit_unavailable", { scope });
    return {
      allowed: false,
      response: json(req, { error: "RATE_LIMIT_UNAVAILABLE" }, {
        status: 503,
        headers: {
          "retry-after": "30",
          "access-control-expose-headers": "Retry-After",
        },
      }),
    };
  }

  if (!rateLimit.allowed) {
    logger.warn("request_rate_limited", {
      scope,
      requestCount: rateLimit.requestCount,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });

    return {
      allowed: false,
      response: json(
        req,
        { error: "TOO_MANY_REQUESTS" },
        {
          status: 429,
          headers: {
            "retry-after": String(rateLimit.retryAfterSeconds),
            "access-control-expose-headers": "Retry-After",
          },
        },
      ),
    };
  }

  logger.info("rate_limit_consumed", {
    scope,
    requestCount: rateLimit.requestCount,
  });

  return { allowed: true, requestCount: rateLimit.requestCount, keyHash };
}
