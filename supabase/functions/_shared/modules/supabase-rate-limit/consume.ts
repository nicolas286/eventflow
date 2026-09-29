import type { RateLimitOptions, RateLimitResult } from "./types.ts";

type ConsumeRateLimitRow = {
  allowed: boolean;
  request_count: number;
  retry_after_seconds: number;
};

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
    throw new Error(`Unable to consume rate limit: ${error.message}`, {
      cause: error,
    });
  }

  const result = (data as ConsumeRateLimitRow[] | null)?.[0];
  if (!result) throw new Error("Rate limit RPC returned no result");

  return {
    allowed: result.allowed,
    requestCount: result.request_count,
    retryAfterSeconds: result.retry_after_seconds,
  };
}
