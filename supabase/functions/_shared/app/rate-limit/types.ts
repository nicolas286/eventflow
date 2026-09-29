import type { SupabaseClient } from "@supabase/supabase-js";
import type { EdgeLogger } from "../../modules/logger/mod.ts";

export type ConsumeRequestRateLimitInput = {
  req: Request;
  supabase: Pick<SupabaseClient, "rpc">;
  logger: EdgeLogger;
  key: string;
  scope: string;
  limit: number;
  windowSeconds: number;
  salt?: string;
};

export type RequestRateLimitResult =
  | { allowed: true; requestCount: number; keyHash: string }
  | { allowed: false; response: Response };
