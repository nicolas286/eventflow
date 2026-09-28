import { createClient } from "npm:@supabase/supabase-js@2.91.1";

export type SupabaseRuntimeConfig = {
  supabaseUrl: string;
  anonKey?: string;
  serviceKey: string;
};

export function createAdminClient(config: SupabaseRuntimeConfig) {
  return createClient(config.supabaseUrl, config.serviceKey);
}

export type AdminClient = ReturnType<typeof createAdminClient>;
