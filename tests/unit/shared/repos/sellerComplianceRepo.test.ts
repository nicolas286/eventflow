import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { sellerComplianceRepo } from "../../../../src/app/modules/admin/organization/data/sellerComplianceRepo";

describe("seller agreement acceptance", () => {
  it("sends each of the four displayed document versions to the audit RPC", async () => {
    const supabase = createClient("https://example.supabase.co", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const rpc = vi.spyOn(supabase, "rpc").mockResolvedValue({
      data: {}, error: null, count: null, status: 200, statusText: "OK",
    });
    await sellerComplianceRepo(supabase).acceptAgreements("11111111-1111-4111-8111-111111111111");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("accept_organization_platform_agreements", {
      p_org_id: "11111111-1111-4111-8111-111111111111",
      p_connect_version: "2026-10-01",
      p_dpa_version: "2026-10-01",
      p_platform_terms_version: "2026-10-01",
      p_privacy_version: "2026-10-01",
    });
  });
});
