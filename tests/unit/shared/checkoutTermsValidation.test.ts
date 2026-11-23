import { describe, expect, it } from "vitest";
import { getCheckoutTermsError } from "../../../src/app/modules/public/register/helpers/checkoutTermsValidation";

const paid = {
  accepted: false,
  requiresOrganizerTerms: true,
  salesTermsRead: false,
};

describe("checkout terms validation", () => {
  it("requires reading even if an acceptance flag was already set", () => {
    expect(getCheckoutTermsError({ ...paid, accepted: true })).toContain("Lisez les conditions");
  });

  it("requires explicit acceptance after reading", () => {
    expect(getCheckoutTermsError({ ...paid, salesTermsRead: true })).toContain("cochant la case");
  });

  it("allows continuing only after reading and accepting", () => {
    expect(getCheckoutTermsError({ ...paid, salesTermsRead: true, accepted: true })).toBeNull();
  });

  it("also requires reading the charter when the event has one", () => {
    expect(getCheckoutTermsError({
      ...paid, salesTermsRead: true, accepted: true, charterRequired: true,
    })).toContain("Lisez la charte");
    expect(getCheckoutTermsError({
      ...paid, salesTermsRead: true, accepted: true, charterRequired: true, charterRead: true,
    })).toBeNull();
  });

  it("requires acceptance for a free reservation without requiring seller terms", () => {
    expect(getCheckoutTermsError({ ...paid, requiresOrganizerTerms: false })).toContain("cochant la case");
    expect(getCheckoutTermsError({ ...paid, requiresOrganizerTerms: false, accepted: true })).toBeNull();
  });

  it("blocks continuing again when acceptance is withdrawn", () => {
    const accepted = { ...paid, salesTermsRead: true, accepted: true };
    expect(getCheckoutTermsError(accepted)).toBeNull();
    expect(getCheckoutTermsError({ ...accepted, accepted: false })).not.toBeNull();
  });
});
