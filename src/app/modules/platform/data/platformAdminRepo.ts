import { supabase } from "@gateways/supabase/supabaseClient";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";
import {
  platformAccessSchema,
  platformAdminAccessRequestSchema,
  platformAdminsSchema,
  platformAnnouncementDraftRequestSchema,
  platformAuditSchema,
  platformConfigurationSchema,
  platformFinanceSchema,
  platformOnboardingRequestSchema,
  platformOperationsSchema,
  platformOrganizationDetailSchema,
  platformOrganizationOwnerRequestSchema,
  platformOrganizationPlanRequestSchema,
  platformOrganizationsPageSchema,
  platformOrganizationStatusRequestSchema,
  platformOverviewSchema,
  platformPublicConfigSchema,
  platformRegistrationSettingsRequestSchema,
  platformSimpleMutationSchema,
  platformStepUpRequestSchema,
  platformStepUpResponseSchema,
  type PlatformAction,
} from "@contracts/platform-admin";

type Method = "GET" | "POST" | "PATCH";

async function invoke(path: string, method: Method = "GET", body?: Record<string, unknown>, stepUp?: string) {
  return await edgeSafe<unknown>(
    () => supabase.functions.invoke(`platform-admin/${path}`, {
      method,
      ...(body === undefined ? {} : { body }),
      ...(stepUp ? { headers: { "x-platform-step-up": stepUp } } : {}),
    }),
    "PLATFORM_EMPTY_RESPONSE",
  );
}

export const platformAdminRepo = {
  access: async () => platformAccessSchema.parse(await invoke("access")),
  overview: async (periodDays: number) =>
    platformOverviewSchema.parse(await invoke(`overview?periodDays=${periodDays}`)),
  organizations: async (params: URLSearchParams) =>
    platformOrganizationsPageSchema.parse(await invoke(`organizations?${params}`)),
  organization: async (id: string) =>
    platformOrganizationDetailSchema.parse(await invoke(`organizations/${id}`)),
  finance: async () => platformFinanceSchema.parse(await invoke("finance")),
  operations: async () => platformOperationsSchema.parse(await invoke("operations")),
  configuration: async () => platformConfigurationSchema.parse(await invoke("configuration")),
  audit: async () => platformAuditSchema.parse(await invoke("audit")),
  admins: async () => platformAdminsSchema.parse(await invoke("admins")),
  stepUp: async (action: PlatformAction, targetId: string) => {
    const payload = platformStepUpRequestSchema.parse({ action, targetId });
    return platformStepUpResponseSchema.parse(await invoke("step-up", "POST", payload));
  },
  onboard: async (payload: unknown, token: string) =>
    await invoke("onboarding", "POST", platformOnboardingRequestSchema.parse(payload), token),
  setRegistrationState: async (payload: unknown, token: string) =>
    await invoke("configuration/registrations", "PATCH", platformRegistrationSettingsRequestSchema.parse(payload), token),
  saveAnnouncement: async (payload: unknown) =>
    await invoke("announcements/draft", "POST", platformAnnouncementDraftRequestSchema.parse(payload)),
  publishAnnouncement: async (id: string, reason: string, token: string) =>
    await invoke(`announcements/${id}/publish`, "POST", platformSimpleMutationSchema.parse({ reason }), token),
  retireAnnouncement: async (id: string, reason: string, token: string) =>
    await invoke(`announcements/${id}/retire`, "POST", platformSimpleMutationSchema.parse({ reason }), token),
  changeOrganization: async (
    id: string,
    kind: "status" | "plan" | "owner",
    payload: unknown,
    token: string,
  ) => {
    const schema = kind === "status" ? platformOrganizationStatusRequestSchema : kind === "plan" ? platformOrganizationPlanRequestSchema : platformOrganizationOwnerRequestSchema;
    return await invoke(`organizations/${id}/${kind}`, "PATCH", schema.parse(payload), token);
  },
  changeAdmin: async (kind: "grant" | "revoke", payload: unknown, token: string) =>
    await invoke(`admins/${kind}`, "POST", platformAdminAccessRequestSchema.parse(payload), token),
};

export async function getPlatformPublicConfig(audience: "public" | "organizer") {
  const raw = await edgeSafe<unknown>(
    () => supabase.functions.invoke(`platform-config?audience=${audience}`, { method: "GET" }),
    "PLATFORM_CONFIG_EMPTY_RESPONSE",
  );
  return platformPublicConfigSchema.parse(raw);
}
