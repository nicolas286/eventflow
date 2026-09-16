import { json } from "../http.ts";
import {
  consumeRateLimit,
  hashRateLimitKey,
} from "../../modules/supabase-rate-limit/mod.ts";
import type {
  ConsumeRequestRateLimitInput,
  RequestRateLimitResult,
} from "./types.ts";

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

  const salt = providedSalt ?? Deno.env.get("RATE_LIMIT_SALT");
  if (!salt?.trim()) throw new Error("RATE_LIMIT_SALT is not configured");

  const keyHash = await hashRateLimitKey(key, salt);
  const rateLimit = await consumeRateLimit({
    supabase,
    keyHash,
    scope,
    limit,
    windowSeconds,
  });

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
