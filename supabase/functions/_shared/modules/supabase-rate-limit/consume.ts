import type { RateLimitOptions, RateLimitResult } from "./types.ts";
import { z } from "zod";

const resultSchema = z.array(z.object({
  allowed: z.boolean(),
  request_count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  retry_after_seconds: z.number().int().nonnegative().max(86400),
})).length(1);

export async function consumeRateLimit({
  supabase,
  keyHash,
  scope,
  limit,
  windowSeconds,
}: RateLimitOptions): Promise<RateLimitResult> {
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_key_hash: keyHash,
    p_scope: scope,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    throw new Error("Unable to consume rate limit");
  }

  const parsed = resultSchema.safeParse(data);
  if (!parsed.success) throw new Error("Invalid rate limit result");
  const result = parsed.data[0];
  if (!result.allowed && result.retry_after_seconds < 1) {
    throw new Error("Invalid rate limit retry interval");
  }

  return {
    allowed: result.allowed,
    requestCount: result.request_count,
    retryAfterSeconds: result.retry_after_seconds,
  };
}
