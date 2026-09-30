import type { SupabaseClient } from "@supabase/supabase-js";

import { internal, ResponseError } from "../_shared/errors.ts";

type PlatformPublicConfig = {
  registrationsOpen?: unknown;
  registrationPublicMessage?: unknown;
};

/**
 * Server-side kill switch shared by public and organizer-created orders.
 * The service-role-only RPC is authoritative; the public banner is only UX.
 */
export async function assertPlatformRegistrationsOpen(
  admin: SupabaseClient,
): Promise<void> {
  const { data, error } = await admin.rpc("platform_public_config", {
    p_audience: "public",
  });

  if (error || !data || typeof data !== "object") {
    throw internal("PLATFORM_REGISTRATION_CONFIG_UNAVAILABLE");
  }

  const config = data as PlatformPublicConfig;
  if (config.registrationsOpen !== true) {
    throw new ResponseError(503, "REGISTRATIONS_CLOSED", {
      message: typeof config.registrationPublicMessage === "string"
        ? config.registrationPublicMessage
        : null,
    });
  }
}
