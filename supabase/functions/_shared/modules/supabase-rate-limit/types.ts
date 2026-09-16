import type { SupabaseClient } from "npm:@supabase/supabase-js@2.75.0";

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
