import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeDashboardRepo } from "../../../src/app/modules/admin/dashboard/data/makeDashboardRepo";
import { createOrganizationsRepo } from "../../../src/app/modules/admin/onboarding/data/createOrganizationRepo";
import { updateOrgInfoRepo } from "../../../src/app/modules/admin/organization/data/updateOrgInfoRepo";
import { sellerComplianceRepo } from "../../../src/app/modules/admin/organization/data/sellerComplianceRepo";
import { updateAdminProfileRepo } from "../../../src/app/modules/admin/profile/data/updateAdminProfileRepo";
import { updateOrgBrandingRepo } from "../../../src/app/modules/admin/branding/data/updateOrgBrandingRepo";
import { EdgeRequestError } from "../../../src/shared/errors/edgeRequestError";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const profile = {
  userId, firstName: "Alice", addressLine1: "rue snake_case", countryCode: "BE",
  stripeConnectAllowed: false, createdAt: "2026-10-01", updatedAt: "2026-10-03",
};
const bootstrap = {
  profile, membership: [{ orgId, userId, role: "owner", createdAt: "2026-10-01" }],
  organization: null, organizationProfile: null, subscription: null,
  planLimits: {
    plan: null, maxEventsPerYear: null, maxRegistrationsPerEvent: null,
    maxProductsPerEvent: null, maxFormFields: null, maxAdmins: null,
    brandingRequired: true, customDomainAllowed: false, apiAccess: false,
    advancedAnalytics: false, promoCodes: false, automatedEmails: false,
  },
};
const branding = {
  orgId, displayName: "Association", primaryColor: "#aabbcc", logoUrl: null,
  defaultEventBannerUrl: null, widgetBg: "#ffffff", widgetCard: "#cccccc",
  widgetText: "#000000", widgetButton: "#bbbbbb",
};
const updatedOrg = {
  orgId, type: "association", name: "Association", status: "trial",
  paymentStatus: "not_connected", paymentsLiveReady: false,
  profile: {
    slug: "association", displayName: "Association", description: null,
    publicEmail: null, phone: null, website: null, emailReminderDaysBefore: null,
  },
};

function fixture() {
  const supabase = createClient("https://example.supabase.co", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const functions = supabase.functions;
  vi.spyOn(supabase, "functions", "get").mockReturnValue(functions);
  return {
    supabase,
    invoke: vi.spyOn(functions, "invoke"),
    rpc: vi.spyOn(supabase, "rpc"),
    from: vi.spyOn(supabase, "from"),
  };
}

describe("organization repositories through the Edge API", () => {
  let client: ReturnType<typeof fixture>;
  beforeEach(() => { client = fixture(); });
  afterEach(() => {
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("requests the default dashboard or an explicitly selected organization", async () => {
    client.invoke.mockResolvedValue({ data: bootstrap, error: null });
    const repo = makeDashboardRepo(client.supabase);
    expect(await repo.getDashboardBootstrap()).toEqual(bootstrap);
    expect(client.invoke).toHaveBeenLastCalledWith("organizations/bootstrap", { body: {} });
    expect(await repo.getDashboardBootstrap(orgId)).toEqual(bootstrap);
    expect(client.invoke).toHaveBeenLastCalledWith("organizations/bootstrap", { body: { orgId } });
    await expect(repo.getDashboardBootstrap("invalid")).rejects.toThrow();
    expect(client.invoke).toHaveBeenCalledTimes(2);
  });

  it("supports the dashboard of a user with no organization", async () => {
    client.invoke.mockResolvedValue({ data: { ...bootstrap, membership: null }, error: null });
    expect((await makeDashboardRepo(client.supabase).getDashboardBootstrap())?.membership).toBeNull();
  });

  it("creates an organization with a strict trimmed payload and returns its UUID", async () => {
    client.invoke.mockResolvedValue({ data: orgId, error: null });
    expect(await createOrganizationsRepo(client.supabase).createOrganization({
      type: "association", name: " Association ",
    })).toBe(orgId);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("organizations/create", {
      body: { type: "association", name: "Association" },
    });
  });

  it("updates organization information and accepts trial status in the response", async () => {
    client.invoke.mockResolvedValue({ data: updatedOrg, error: null });
    const input = { orgId, name: "Association", publicEmail: null, emailReminderDaysBefore: 3 };
    expect(await updateOrgInfoRepo(client.supabase).updateOrgInfo(input)).toEqual(updatedOrg);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("organizations/update", { body: input });
  });

  it("updates the profile in camelCase without converting JSON keys or string values", async () => {
    client.invoke.mockResolvedValue({ data: profile, error: null });
    const input = { userId, patch: { addressLine1: "rue snake_case", countryCode: "BE", city: null } };
    expect(await updateAdminProfileRepo(client.supabase).updateAdminProfile(input)).toEqual(profile);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("organizations/profile", { body: input });
  });

  it("updates branding including widget colors through the shared contract", async () => {
    client.invoke.mockResolvedValue({ data: branding, error: null });
    const input = { orgId, patch: { widgetBg: "#ffffff", logoUrl: null } };
    expect(await updateOrgBrandingRepo(client.supabase).updateOrgBranding(input)).toEqual(branding);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("organizations/branding", { body: input });
  });

  it("normalizes seller identity and validates the mutation acknowledgement", async () => {
    client.invoke.mockResolvedValue({ data: { success: true }, error: null });
    await sellerComplianceRepo(client.supabase).saveIdentity(orgId, {
      legalName: " Association ", address: " Rue des tests 1 ", businessNumber: " ",
      sellerType: "professional", phone: " +3212345678 ",
    });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("organizations/seller-identity", {
      body: {
        orgId, legalName: "Association", address: "Rue des tests 1", businessNumber: null,
        sellerType: "professional", phone: "+3212345678",
      },
    });
  });

  it("rejects sensitive or unknown fields before issuing any request", async () => {
    const createInput = { type: "association" as const, name: "Association", plan: "pro" };
    await expect(createOrganizationsRepo(client.supabase).createOrganization(createInput)).rejects.toThrow();
    await expect(updateOrgInfoRepo(client.supabase).updateOrgInfo({
      orgId, name: "Association", paymentsLiveReady: true,
    })).rejects.toThrow();
    const profileInput = { userId, patch: { city: "Bruxelles", stripeConnectAllowed: true } };
    await expect(updateAdminProfileRepo(client.supabase).updateAdminProfile(profileInput)).rejects.toThrow();
    const brandingInput = { orgId, patch: { displayName: "Association", sellerLegalName: "Spoofed" } };
    await expect(updateOrgBrandingRepo(client.supabase).updateOrgBranding(brandingInput)).rejects.toThrow();
    const identity = {
      legalName: "Association", address: "Rue des tests 1", businessNumber: "123456789",
      sellerType: "professional" as const, phone: "+3212345678", acceptedBy: userId,
    };
    await expect(sellerComplianceRepo(client.supabase).saveIdentity(orgId, identity)).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("rejects an empty organization patch and unselected seller type", async () => {
    await expect(updateOrgInfoRepo(client.supabase).updateOrgInfo({ orgId })).rejects.toThrow("EMPTY_PATCH");
    await expect(sellerComplianceRepo(client.supabase).saveIdentity(orgId, {
      legalName: "Association", address: "Rue des tests 1", businessNumber: "", sellerType: "", phone: "+3212345678",
    })).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("rejects invalid responses instead of reporting successful saves", async () => {
    client.invoke.mockResolvedValue({ data: { success: false }, error: null });
    await expect(sellerComplianceRepo(client.supabase).acceptAgreements(orgId)).rejects.toThrow();
    await expect(createOrganizationsRepo(client.supabase).createOrganization({ type: "person", name: "Alice" })).rejects.toThrow();
    await expect(makeDashboardRepo(client.supabase).getDashboardBootstrap()).rejects.toThrow();
    await expect(updateAdminProfileRepo(client.supabase).updateAdminProfile({ userId, patch: { city: "Bruxelles" } })).rejects.toThrow();
  });

  it.each([
    [429, "TOO_MANY_REQUESTS", 12],
    [503, "RATE_LIMIT_UNAVAILABLE", 30],
  ])("preserves quota error %s and its Retry-After metadata", async (status, code, delay) => {
    const response = new Response(JSON.stringify({ error: code }), {
      status, headers: { "Retry-After": String(delay), "Content-Type": "application/json" },
    });
    client.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("HTTP failure"), { context: response }) });
    const promise = updateOrgBrandingRepo(client.supabase).updateOrgBranding({ orgId, patch: { logoUrl: null } });
    await expect(promise).rejects.toBeInstanceOf(EdgeRequestError);
    await expect(promise).rejects.toMatchObject({ message: code, status, retryAfterSeconds: delay });
  });

  it("preserves a controlled authorization failure", async () => {
    client.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 }) } });
    await expect(updateOrgInfoRepo(client.supabase).updateOrgInfo({ orgId, name: "Association" })).rejects.toThrow("FORBIDDEN");
  });
});
