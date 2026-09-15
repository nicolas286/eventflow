import type { SupabaseClient } from "npm:@supabase/supabase-js@2.75.0";
import {
  createAnonClient,
  createAuthorizationClient,
  type EnvironmentReader,
  readSupabaseRuntimeConfig,
  type SupabaseRuntimeConfig,
} from "../modules/supabase-runtime/mod.ts";

export type RequestSupabaseContextOptions = {
  environment?: EnvironmentReader;
  useRequestAuthorization?: boolean;
};

export type RequestSupabaseContext = {
  runtime: SupabaseRuntimeConfig;
  authClient: SupabaseClient;
  supabase: SupabaseClient;
};

export function createRequestSupabaseContext(
  req: Request,
  options: RequestSupabaseContextOptions = {},
): RequestSupabaseContext {
  const runtime = readSupabaseRuntimeConfig(options.environment ?? Deno.env);
  const authClient = createAnonClient(runtime);
  const authorization = options.useRequestAuthorization === false
    ? null
    : req.headers.get("authorization");

  return {
    runtime,
    authClient,
    supabase: authorization
      ? createAuthorizationClient(runtime, authorization)
      : authClient,
  };
}
