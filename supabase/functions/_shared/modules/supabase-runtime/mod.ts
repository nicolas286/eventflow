import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

export interface SupabaseRuntimeConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
}

export interface EnvironmentReader {
  get(name: string): string | undefined;
}

const edgeAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
} as const;

function requireValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing ${name}`);
  return normalized;
}

export function readSupabaseRuntimeConfig(
  environment: EnvironmentReader,
): SupabaseRuntimeConfig {
  return {
    supabaseUrl: requireValue(environment.get("SUPABASE_URL"), "SUPABASE_URL"),
    supabaseAnonKey: requireValue(
      environment.get("SUPABASE_ANON_KEY"),
      "SUPABASE_ANON_KEY",
    ),
    supabaseServiceRoleKey: requireValue(
      environment.get("SUPABASE_SERVICE_ROLE_KEY"),
      "SUPABASE_SERVICE_ROLE_KEY",
    ),
  };
}

export function createAnonClient<TDatabase>(
  config: SupabaseRuntimeConfig,
): SupabaseClient<TDatabase> {
  return createClient<TDatabase>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: edgeAuthOptions,
  });
}

export function createAuthorizationClient<TDatabase>(
  config: SupabaseRuntimeConfig,
  authorization: string,
): SupabaseClient<TDatabase> {
  return createClient<TDatabase>(config.supabaseUrl, config.supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: edgeAuthOptions,
  });
}

export function createUserClient<TDatabase>(
  config: SupabaseRuntimeConfig,
  accessToken: string,
): SupabaseClient<TDatabase> {
  return createAuthorizationClient<TDatabase>(
    config,
    accessToken.startsWith("Bearer ") ? accessToken : `Bearer ${accessToken}`,
  );
}

export function createServiceClient<TDatabase>(
  config: SupabaseRuntimeConfig,
): SupabaseClient<TDatabase> {
  return createClient<TDatabase>(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    { auth: edgeAuthOptions },
  );
}
