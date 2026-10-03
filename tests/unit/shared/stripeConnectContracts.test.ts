import { describe, expect, it } from "vitest";
import * as shared from "../../../shared/schemas/stripe-connect";
import * as frontend from "../../../src/app/modules/admin/payments/schemas/admin.stripeConnect.schema";

describe("shared Stripe Connect contracts", () => {
  it("frontend and backend use the same contracts", () => {
    expect(frontend.stripeConnectInputSchema).toBe(shared.stripeConnectInputSchema);
    expect(frontend.stripeConnectStartResultSchema).toBe(shared.stripeConnectStartResultSchema);
    expect(frontend.stripeConnectStatusResultSchema).toBe(shared.stripeConnectStatusResultSchema);
    expect(shared.stripeConnectInputSchema.parse({ orgId: "22222222-2222-4222-8222-222222222222" })).toEqual({ orgId: "22222222-2222-4222-8222-222222222222" });
    for (const input of [null, {}, { orgId: 42 }, { orgId: "invalid" }, { orgId: "22222222-2222-7222-8222-222222222222" }]) {
      expect(shared.stripeConnectInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("keeps response fields and strips provider fields", () => {
    expect(shared.stripeConnectStartResultSchema.parse({ ok: true, url: "https://connect.stripe.com/fixture", secret: "fixture" })).toEqual({ ok: true, url: "https://connect.stripe.com/fixture" });
    for (const status of ["pending", "connected", "requires_migration"]) {
      const data = { ok: true, status, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false,
        complianceVerified: false, accountType: null, configurationSupported: false,
        requirementsDisabledReason: null, requirementsCurrentlyDue: ["business_profile.url"] };
      expect(shared.stripeConnectStatusResultSchema.parse({ ...data, secret: "fixture" })).toEqual(data);
    }
  });
});
