import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type AdminRegisterPayload,
  type AdminRegisterResponse,
  adminRegisterResponseSchema,
} from "@app/modules/public/register/schemas/admin.registerPayload.schema";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";

export function createAdminRegisterRepo(supabase: SupabaseClient) {
  return {
    async register(input: AdminRegisterPayload): Promise<AdminRegisterResponse> {
      const raw = await edgeSafe(
        () => supabase.functions.invoke("orders/admin", { body: input }),
        "ADMIN_REGISTER_EMPTY_RESPONSE"
      );

      return adminRegisterResponseSchema.parse(raw);
    },
  };
}