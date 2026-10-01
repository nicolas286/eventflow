import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseSafe } from "@shared/gateways/supabase/supabaseSafe";

export type SellerIdentityInput = {
  legalName: string;
  address: string;
  businessNumber: string;
  sellerType: "professional" | "non_professional" | "";
  phone: string;
};

export function sellerComplianceRepo(supabase: SupabaseClient) {
  return {
    async saveIdentity(orgId: string, identity: SellerIdentityInput) {
      await supabaseSafe(() => supabase.rpc("update_organization_seller_identity", {
        p_org_id: orgId,
        p_legal_name: identity.legalName.trim(),
        p_address: identity.address.trim(),
        p_business_number: identity.businessNumber.trim() || null,
        p_seller_type: identity.sellerType,
        p_phone: identity.phone.trim(),
      }));
    },
    async acceptAgreements(orgId: string) {
      await supabaseSafe(() => supabase.rpc("accept_organization_platform_agreements", {
        p_org_id: orgId,
        p_connect_version: "2026-10-01",
        p_dpa_version: "2026-10-01",
        p_platform_terms_version: "2026-10-01",
        p_privacy_version: "2026-10-01",
      }));
    },
  };
}
