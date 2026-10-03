import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeOrganizationBillingRepo } from "../../../src/app/modules/admin/subscriptions/data/makeOrganizationBillingRepo";
import { EdgeRequestError } from "../../../src/shared/errors/edgeRequestError";

const orgId = "11111111-1111-4111-8111-111111111111";
const billing = {
  orgId, legalName: "Association", addressLine1: "Rue des tests 1", addressLine2: null,
  postalCode: "1000", city: "Bruxelles", countryCode: "BE", billingEmail: "billing@example.com",
  vatCountryCode: "BE", vatNumber: "BE0123456789", invoiceReference: null,
  isVatValidated: false, vatValidatedAt: null, vatValidationSource: null,
  createdAt: "2026-10-01", updatedAt: "2026-10-03",
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

describe("organization billing through the Edge API", () => {
  let client: ReturnType<typeof fixture>;
  beforeEach(() => { client = fixture(); });
  afterEach(() => {
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("reads a billing DTO from the API envelope", async () => {
    client.invoke.mockResolvedValue({ data: { billing }, error: null });
    expect(await makeOrganizationBillingRepo(client.supabase).getOrganizationBilling(orgId)).toEqual(billing);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("organizations/billing/read", {
      body: { orgId },
    });
  });

  it("preserves the absence of billing data as null", async () => {
    client.invoke.mockResolvedValue({ data: { billing: null }, error: null });
    expect(await makeOrganizationBillingRepo(client.supabase).getOrganizationBilling(orgId)).toBeNull();
  });

  it("sends a partial patch without adding absent fields and returns a billing DTO", async () => {
    client.invoke.mockResolvedValue({ data: { ...billing, city: "Namur" }, error: null });
    expect(await makeOrganizationBillingRepo(client.supabase).upsertOrganizationBilling({
      orgId, city: " Namur ",
    })).toEqual({ ...billing, city: "Namur" });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("organizations/billing/update", {
      body: { orgId, city: "Namur" },
    });
  });

  it("preserves explicitly null values to clear optional fields", async () => {
    client.invoke.mockResolvedValue({
      data: { ...billing, vatCountryCode: null, vatNumber: null, billingEmail: null }, error: null,
    });
    const patch = { orgId, vatCountryCode: null, vatNumber: null, billingEmail: null, invoiceReference: null };
    const result = await makeOrganizationBillingRepo(client.supabase).upsertOrganizationBilling(patch);
    expect(result.vatCountryCode).toBeNull();
    expect(result.vatNumber).toBeNull();
    expect(result.billingEmail).toBeNull();
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("organizations/billing/update", { body: patch });
  });

  it("normalizes country, VAT and email without changing the contract to snake_case", async () => {
    client.invoke.mockResolvedValue({ data: billing, error: null });
    await makeOrganizationBillingRepo(client.supabase).upsertOrganizationBilling({
      orgId, countryCode: " be ", vatCountryCode: " be ", vatNumber: " be 0123456789 ",
      billingEmail: " Billing@Example.COM ", legalName: " Association ", invoiceReference: " INV_ref ",
    });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("organizations/billing/update", {
      body: {
        orgId, countryCode: "BE", vatCountryCode: "BE", vatNumber: "BE0123456789",
        billingEmail: "billing@example.com", legalName: "Association", invoiceReference: "INV_ref",
      },
    });
  });

  it.each([
    { isVatValidated: true }, { vatValidatedAt: "2026-10-03" },
    { vatValidationSource: "forged" }, { plan: "pro" }, { userId: orgId },
    { createdAt: "2026-10-03" },
  ])("rejects sensitive or unknown patch fields %j before requesting the API", async (forbidden) => {
    const patch = { orgId, city: "Bruxelles", ...forbidden };
    await expect(makeOrganizationBillingRepo(client.supabase).upsertOrganizationBilling(patch)).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("rejects invalid organization IDs, empty patches and mismatched VAT fields", async () => {
    const repo = makeOrganizationBillingRepo(client.supabase);
    await expect(repo.getOrganizationBilling("invalid")).rejects.toThrow();
    await expect(repo.upsertOrganizationBilling({ orgId })).rejects.toThrow();
    await expect(repo.upsertOrganizationBilling({ orgId, vatCountryCode: "BE", vatNumber: null })).rejects.toThrow();
    await expect(repo.upsertOrganizationBilling({ orgId, vatCountryCode: null, vatNumber: "BE0123456789" })).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it.each([JSON.stringify(billing), [billing], { billing }, { success: true }])(
    "rejects old RPC response wrapping on updates", async (data) => {
      client.invoke.mockResolvedValue({ data, error: null });
      await expect(makeOrganizationBillingRepo(client.supabase).upsertOrganizationBilling({ orgId, city: "Bruxelles" })).rejects.toThrow();
    },
  );

  it("rejects an empty read response instead of treating a failed request as absent billing", async () => {
    client.invoke.mockResolvedValue({ data: null, error: null });
    await expect(makeOrganizationBillingRepo(client.supabase).getOrganizationBilling(orgId)).rejects.toThrow("EDGE_EMPTY_RESPONSE");
  });

  it.each([
    [429, "TOO_MANY_REQUESTS", 12], [503, "RATE_LIMIT_UNAVAILABLE", 30],
  ])("preserves quota error %s and its Retry-After metadata", async (status, code, delay) => {
    client.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("HTTP failure"), {
        context: new Response(JSON.stringify({ error: code }), {
          status, headers: { "Retry-After": String(delay), "Content-Type": "application/json" },
        }),
      }),
    });
    const promise = makeOrganizationBillingRepo(client.supabase).upsertOrganizationBilling({ orgId, city: "Bruxelles" });
    await expect(promise).rejects.toBeInstanceOf(EdgeRequestError);
    await expect(promise).rejects.toMatchObject({ message: code, status, retryAfterSeconds: delay });
  });

  it("preserves controlled permission errors", async () => {
    client.invoke.mockResolvedValue({
      data: null, error: { context: new Response(JSON.stringify({ error: "FORBIDDEN" }), { status: 403 }) },
    });
    await expect(makeOrganizationBillingRepo(client.supabase).getOrganizationBilling(orgId)).rejects.toThrow("FORBIDDEN");
  });
});
