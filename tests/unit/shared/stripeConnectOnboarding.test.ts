import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Organization } from "../../../src/shared/models/db/db.organization.schema";
import type { OrganizationProfile } from "../../../src/shared/models/db/db.organizationProfile.schema";

vi.mock("@shared/gateways/supabase/supabaseClient", () => ({ supabase: {} }));
vi.mock("react-router-dom", () => ({
  useLocation: () => ({ pathname: "/admin/organisation", search: "" }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@shared/ui/components/inputs/MarkdownRichTextArea", () => ({
  MarkdownRichTextarea: ({ label, value }: { label?: string; value: string }) =>
    createElement("textarea", { "aria-label": label, defaultValue: value }),
}));
vi.mock("../../../src/app/modules/admin/organization/hooks/useSaveOrgInfo", () => ({
  useSaveOrgInfo: () => ({ loading: false, error: null, updated: null,
    saveOrgInfo: vi.fn(), reset: vi.fn(), hasChanges: () => false }),
}));
vi.mock("../../../src/app/modules/admin/organization/hooks/useSavePaymentSettings", () => ({
  useSavePaymentSettings: () => ({ loading: false, error: null, updated: null,
    save: vi.fn(), acceptTerms: vi.fn(), reset: vi.fn(), read: vi.fn() }),
}));
vi.mock("../../../src/app/modules/admin/payments/hooks/useStripeConnect", () => ({
  useStripeConnect: () => ({ loading: false, error: null, start: vi.fn(), refreshStatus: vi.fn() }),
}));

import OrganizationPanel from "../../../src/app/modules/admin/organization/components/OrganizationPanel/OrganizationPanel";

const org: Organization = {
  id: "10000000-0000-4000-8000-000000000001", type: "association", name: "Fixture",
  status: "active", createdAt: "2026-01-01", createdBy: "10000000-0000-4000-8000-000000000002",
  paymentsProvider: "stripe", paymentsStatus: "not_connected", paymentsLiveReady: false,
  plan: "pro", planStartedAt: "2026-01-01", planExpiresAt: null,
};
const profile: OrganizationProfile = {
  orgId: org.id, slug: "fixture", displayName: "Fixture", description: null,
  publicEmail: null, phone: null, website: null, logoUrl: null, primaryColor: null,
  createdAt: "2026-01-01", updatedAt: "2026-01-01", defaultEventBannerUrl: null,
  emailReminderDaysBefore: null,
};
const acceptance = {
  salesTermsVersion: "v1", salesTermsAcceptedVersion: "v1", salesTermsAcceptedAt: "2026-01-01",
};
const sellerIdentity: Partial<OrganizationProfile> = {
  publicEmail: "contact@example.test",
  sellerLegalName: "Fixture ASBL",
  sellerAddress: "Rue Exemple 12, 1000 Bruxelles, Belgique",
  sellerBusinessNumber: "BE0123456789",
  sellerType: "professional",
  phone: "+3221234567",
};
const platformAcceptance = {
  connectTermsAcceptedVersion: "2026-10-01",
  dpaAcceptedVersion: "2026-10-01",
  platformTermsAcceptedVersion: "2026-10-01",
  privacyAcceptedVersion: "2026-10-01",
};
const connected: Partial<Organization> = {
  stripeConnectedAccountId: "acct_fixture", stripeDetailsSubmitted: true,
  stripeChargesEnabled: true, stripePayoutsEnabled: true,
};
function render(profilePatch: Partial<OrganizationProfile> = {}, orgPatch: Partial<Organization> = {}, stripeConnectAllowed = true, canManageAgreements = true) {
  return renderToStaticMarkup(createElement(OrganizationPanel, {
    orgId: org.id, orgInfo: { ...org, ...orgPatch }, orgProfile: { ...profile, ...profilePatch },
    stripeConnectAllowed, canManageAgreements, onSaved: async () => {},
  }));
}

describe("Stripe onboarding prerequisites", () => {
  it.each([null, "", "invalid-email"])("blocks setup without a valid stored email: %s", (publicEmail) => {
    const html = render({ ...sellerIdentity, ...acceptance, ...platformAcceptance, publicEmail });
    expect(html).toContain("1. Identité du vendeur et contact");
    expect(html).not.toContain("Configurer Stripe</");
    expect(html).not.toContain('aria-label="Conditions organisateur"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continuer<\/button>/u);
  });

  it("requires explicit approval and explains terms before the editor", () => {
    const html = render(sellerIdentity);
    expect(html).toContain("2. Vos conditions organisateur");
    expect(html).toContain("Ces conditions sont présentées aux acheteurs.");
    expect(html.indexOf("Ces conditions sont présentées aux acheteurs.")).toBeLessThan(
      html.indexOf('aria-label="Conditions organisateur"'),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Valider et continuer<\/button>/u);
    expect(html).not.toContain("Configurer Stripe</");
  });

  it("requires reapproval when the accepted version differs", () => {
    const html = render({ ...sellerIdentity, ...acceptance, ...platformAcceptance, salesTermsVersion: "v2" });
    expect(html).toContain("2. Vos conditions organisateur");
    expect(html).not.toContain("Configurer Stripe</");
  });

  it("offers setup once the seller identity and every agreement are current", () => {
    const html = render({ ...sellerIdentity, ...acceptance, ...platformAcceptance });
    expect(html).toContain("3. Votre compte Stripe");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Configurer Stripe<\/button>/u);
    expect(html).not.toContain("Le paiement par virement est désactivé");
  });

  it("preserves management access for a connected organisation with current agreements", () => {
    const html = render({ ...sellerIdentity, ...acceptance, ...platformAcceptance }, connected);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Gérer le compte Stripe<\/button>/u);
    expect(html).toContain("Connecté");
  });

  it("keeps an existing seller connected while offering explicit acceptance of all four renewed documents", () => {
    const html = render({
      ...sellerIdentity, ...acceptance,
      connectTermsAcceptedVersion: "2026-09-29",
      dpaAcceptedVersion: "2026-09-29",
    }, connected);
    expect(html).toContain("3. Votre compte Stripe");
    expect(html).toContain('href="/cgu"');
    expect(html).toContain('href="/politique-confidentialite"');
    expect(html).toContain('href="/conditions-connect"');
    expect(html).toContain('href="/accord-traitement-donnees"');
    expect(html).toContain("Je confirme avoir pris connaissance");
    expect(html.match(/type="checkbox"/gu)).toHaveLength(4);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked/gu);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Valider les accords Eventflow<\/button>/u);
    expect(html).not.toContain("Continuer avec les conditions validées");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Gérer le compte Stripe<\/button>/u);
    expect(html).not.toContain("non prêt");
  });

  it.each([
    "connectTermsAcceptedVersion", "dpaAcceptedVersion",
    "platformTermsAcceptedVersion", "privacyAcceptedVersion",
  ] as const)("keeps Stripe management available when %s alone is outdated", (field) => {
    const html = render({ ...sellerIdentity, ...acceptance, ...platformAcceptance, [field]: "old" }, connected);
    expect(html).toContain("3. Votre compte Stripe");
    expect(html).toContain("Valider les accords Eventflow");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Gérer le compte Stripe<\/button>/u);
  });

  it("requires the public seller identity before a new Stripe onboarding", () => {
    const html = render({ publicEmail: "contact@example.test", ...acceptance, ...platformAcceptance });
    expect(html).toContain("1. Identité du vendeur et contact");
    expect(html).toContain("Nom légal du vendeur");
    expect(html).not.toContain("Gérer le compte Stripe</");
  });

  it("keeps a connected account ready without the newly requested identity or agreements", () => {
    const html = render({ publicEmail: "contact@example.test", ...acceptance }, connected);
    expect(html).toContain("3. Votre compte Stripe");
    expect(html).not.toContain("non prêt");
    expect(html).toContain("Compléter l’identité du vendeur");
    expect(html).toContain("Valider les accords Eventflow");
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>Gérer le compte Stripe<\/button>/u);
  });

  it("does not offer onboarding without Stripe permission", () => {
    const html = render({ publicEmail: "contact@example.test", ...acceptance }, {}, false);
    expect(html).not.toContain('aria-label="Configuration Stripe"');
    expect(html).not.toContain("Configurer Stripe</");
    expect(html).not.toContain("Gérer le compte Stripe</");
    expect(html).toContain("Vos accords avec Eventflow");
    expect(html).toContain("Valider les accords Eventflow");
    expect(html.match(/type="checkbox"/gu)).toHaveLength(4);
  });

  it("does not expose agreement acceptance to members without manager rights", () => {
    const html = render({ ...sellerIdentity }, {}, false, false);
    expect(html).not.toContain("Vos accords avec Eventflow");
    expect(html).not.toContain("Valider les accords Eventflow");
    expect(html).not.toContain("Configurer Stripe</");
  });
});
