import { conflict, internal } from "../errors.ts";
import type { AdminClient } from "../supabase.ts";

export type OrganizationSalesTerms = {
  displayName: string;
  publicEmail: string;
  phone: string | null;
  website: string | null;
  salesTerms: string;
  salesTermsVersion: string;
};

export async function getAcceptedOrganizationSalesTerms(
  admin: AdminClient,
  orgId: string,
): Promise<OrganizationSalesTerms> {
  const { error: contractError } = await admin.rpc(
    "assert_organization_contract_ready",
    { p_org_id: orgId },
  );
  if (contractError) {
    const code = [
      "ORGANIZER_SELLER_IDENTITY_REQUIRED",
      "ORGANIZER_PLATFORM_AGREEMENTS_REQUIRED",
      "ORGANIZER_SALES_TERMS_REQUIRED",
    ].find((value) => contractError.message.includes(value));
    if (code) throw conflict(code);
    throw internal("ORGANIZER_TERMS_LOAD_FAILED");
  }
  const { data, error } = await admin
    .from("organization_profile")
    .select(
      "display_name, public_email, phone, website, sales_terms, sales_terms_version, sales_terms_accepted_version, sales_terms_accepted_at",
    )
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) throw internal("ORGANIZER_TERMS_LOAD_FAILED");

  const displayName = String(data?.display_name ?? "").trim();
  const publicEmail = String(data?.public_email ?? "").trim();
  const salesTerms = String(data?.sales_terms ?? "").trim();
  const salesTermsVersion = String(data?.sales_terms_version ?? "").trim();
  const acceptedVersion = String(
    data?.sales_terms_accepted_version ?? "",
  ).trim();
  const publicEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(publicEmail);

  if (
    !displayName ||
    !publicEmailValid ||
    salesTerms.length < 200 ||
    !salesTermsVersion ||
    !data?.sales_terms_accepted_at ||
    acceptedVersion !== salesTermsVersion
  ) {
    throw conflict("ORGANIZER_SALES_TERMS_REQUIRED");
  }

  return {
    displayName,
    publicEmail,
    phone: typeof data.phone === "string" && data.phone.trim()
      ? data.phone.trim()
      : null,
    website: typeof data.website === "string" && data.website.trim()
      ? data.website.trim()
      : null,
    salesTerms,
    salesTermsVersion,
  };
}
