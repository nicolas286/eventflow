import { describe, expect, it } from "vitest";
import { publicOrgProfileOverviewForEventPageSchema } from "../../../src/app/modules/public/events/schemas/public.eventDetailBySlug.schema";
import { humanBusinessMessage } from "../../../src/shared/errors/businessErrorMessages";

describe("public seller compliance", () => {
  it("preserves the legal identity delivered by the public RPC", () => {
    const seller = {
      sellerLegalName: "Association Exemple ASBL",
      sellerAddress: "Rue Exemple 12, 1000 Bruxelles, Belgique",
      sellerBusinessNumber: "BE0123456789",
      sellerType: "professional",
      phone: "+3221234567",
    };
    const parsed = publicOrgProfileOverviewForEventPageSchema.parse({
      ...seller,
      slug: "exemple", displayName: "Exemple", defaultEventBannerUrl: null,
      logoUrl: null, publicEmail: "contact@example.com", website: null, primaryColor: null,
      salesTerms: "Conditions de vente présentées aux acheteurs. ".repeat(6),
      salesTermsVersion: "seller-v2", salesTermsAccepted: true, paidSalesAvailable: true,
    });
    expect(parsed).toMatchObject(seller);
  });

  it("tells the buyer to read the new version after a stale acceptance", () => {
    expect(humanBusinessMessage("TERMS_CHANGED_RELOAD")).toContain("Rechargez");
    expect(humanBusinessMessage("TERMS_CHANGED_RELOAD")).toContain("relisez");
  });
});
