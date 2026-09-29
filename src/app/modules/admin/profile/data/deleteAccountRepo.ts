import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";
import {
  deleteAccountInputSchema,
  deleteAccountResultSchema,
  type DeleteAccountInput,
  type DeleteAccountResult,
} from "@modules/admin/profile/schemas/admin.deleteAccount.schema";

export function deleteAccountRepo(supabase: SupabaseClient) {
  return {
    async deleteAccount(input?: DeleteAccountInput): Promise<DeleteAccountResult> {
      const payload = deleteAccountInputSchema.parse(input ?? {});

      const raw = await edgeSafe(
        () =>
          supabase.functions.invoke("accounts/me", {
            method: "DELETE",
            body: payload,
          }),
        "DELETE_ACCOUNT_EMPTY_RESPONSE"
      );

      return deleteAccountResultSchema.parse(raw);
    },
  };
}