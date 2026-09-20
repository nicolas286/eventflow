import { createClient } from "@supabase/supabase-js";

export type SupabaseRuntimeConfig = {
  supabaseUrl: string;
  anonKey?: string;
  serviceKey: string;
};

export function createAdminClient(config: SupabaseRuntimeConfig) {
  return createClient(config.supabaseUrl, config.serviceKey);
}