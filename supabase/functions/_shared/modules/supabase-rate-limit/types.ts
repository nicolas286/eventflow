import type { SupabaseClient } from "@supabase/supabase-js";

export type RateLimitOptions = {
  supabase: Pick<SupabaseClient, "rpc">;
  keyHash: string;
  scope: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitResult = {
  allowed: boolean;
  requestCount: number;
  retryAfterSeconds: number;
};
