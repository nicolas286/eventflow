import { DPA_VERSION, EVENTFLOW_CONNECT_TERMS_VERSION, EVENTFLOW_PLATFORM_TERMS_VERSION, EVENTFLOW_PRIVACY_VERSION } from "../../../../../../shared/legal/documents";
import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@shared/gateways/supabase/supabaseEdgeSafe";
import {
  sellerIdentityRequestSchema,
  acceptAgreementsRequestSchema,
  mutationSuccessSchema,
} from "@contracts/organizations";

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
      const body = sellerIdentityRequestSchema.parse({
        ...identity,
        orgId,
        businessNumber: identity.businessNumber.trim() || null,
      });
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organizations/seller-identity", { body })
      );
      mutationSuccessSchema.parse(raw);
    },
    async acceptAgreements(orgId: string) {
      const body = acceptAgreementsRequestSchema.parse({
        orgId,
        connectVersion: EVENTFLOW_CONNECT_TERMS_VERSION,
        dpaVersion: DPA_VERSION,
        platformTermsVersion: EVENTFLOW_PLATFORM_TERMS_VERSION,
        privacyVersion: EVENTFLOW_PRIVACY_VERSION,
      });
      const raw = await edgeSafe<unknown>(() =>
        supabase.functions.invoke("organizations/agreements", { body })
      );
      mutationSuccessSchema.parse(raw);
    },
  };
}
