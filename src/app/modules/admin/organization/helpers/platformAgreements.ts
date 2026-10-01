import type { OrganizationProfile } from "@shared/models/db/db.organizationProfile.schema";
import { DPA_VERSION, EVENTFLOW_CONNECT_TERMS_VERSION, EVENTFLOW_PLATFORM_TERMS_VERSION, EVENTFLOW_PRIVACY_VERSION } from "../../../../../../shared/legal/documents";

export type PlatformAgreementVersions = Pick<OrganizationProfile,
  "connectTermsAcceptedVersion" | "dpaAcceptedVersion" | "platformTermsAcceptedVersion" | "privacyAcceptedVersion">;

export type PlatformAgreementAccess = {
  organization: { id: string } | null;
  profile: { userId: string };
  membership: ReadonlyArray<{ orgId: string; userId: string; role: string }> | null;
};

export function platformAgreementsCurrent(profile: PlatformAgreementVersions | null): boolean {
  return profile?.connectTermsAcceptedVersion === EVENTFLOW_CONNECT_TERMS_VERSION &&
    profile?.dpaAcceptedVersion === DPA_VERSION &&
    profile?.platformTermsAcceptedVersion === EVENTFLOW_PLATFORM_TERMS_VERSION &&
    profile?.privacyAcceptedVersion === EVENTFLOW_PRIVACY_VERSION;
}

export function canManagePlatformAgreements(bootstrap: PlatformAgreementAccess): boolean {
  return Boolean(bootstrap.organization && bootstrap.membership?.some((member) =>
    member.orgId === bootstrap.organization?.id && member.userId === bootstrap.profile.userId &&
    (member.role === "owner" || member.role === "admin"),
  ));
}
