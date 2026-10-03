import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { sellerComplianceRepo } from "../../../../src/app/modules/admin/organization/data/sellerComplianceRepo";
import { DPA_VERSION, EVENTFLOW_CONNECT_TERMS_VERSION, EVENTFLOW_PLATFORM_TERMS_VERSION, EVENTFLOW_PRIVACY_VERSION } from "../../../../shared/legal/documents";

describe("seller agreement acceptance", () => {
  it("sends each of the four displayed document versions to the Edge API", async () => {
    const supabase = createClient("https://example.supabase.co", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const functions = supabase.functions;
    vi.spyOn(supabase, "functions", "get").mockReturnValue(functions);
    const invoke = vi.spyOn(functions, "invoke").mockResolvedValue({
      data: { success: true }, error: null,
    });
    await sellerComplianceRepo(supabase).acceptAgreements("11111111-1111-4111-8111-111111111111");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("organizations/agreements", {
      body: {
        orgId: "11111111-1111-4111-8111-111111111111",
        connectVersion: EVENTFLOW_CONNECT_TERMS_VERSION,
        dpaVersion: DPA_VERSION,
        platformTermsVersion: EVENTFLOW_PLATFORM_TERMS_VERSION,
        privacyVersion: EVENTFLOW_PRIVACY_VERSION,
      },
    });
  });
});
