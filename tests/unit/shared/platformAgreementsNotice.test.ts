import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlatformAgreementsNotice } from "../../../src/app/modules/admin/notices/components/PlatformAgreementsNotice";

vi.mock("react-router-dom", () => ({
  Link: ({ to, children }: { to: string; children: string }) => createElement("a", { href: to }, children),
}));

const versions = {
  connectTermsAcceptedVersion: "2026-10-01", dpaAcceptedVersion: "2026-10-01",
  platformTermsAcceptedVersion: "2026-10-01", privacyAcceptedVersion: "2026-10-01",
};
const context = {
  organization: { id: "org-one" },
  profile: { userId: "owner-one" },
  membership: [{ orgId: "org-one", userId: "owner-one", role: "owner" }],
  organizationProfile: {},
};

describe("persistent seller agreements notice", () => {
  it("offers owners a path to acceptance without depending on Stripe permission", () => {
    const html = renderToStaticMarkup(createElement(PlatformAgreementsNotice, { bootstrap: context }));
    expect(html).toContain("Action requise");
    expect(html).toContain('/admin/structure#platform-agreements');
    expect(html).not.toContain("dismiss");
  });

  it("disappears only after all four current versions are recorded", () => {
    expect(renderToStaticMarkup(createElement(PlatformAgreementsNotice, {
      bootstrap: { ...context, organizationProfile: versions },
    }))).toBe("");
    expect(renderToStaticMarkup(createElement(PlatformAgreementsNotice, {
      bootstrap: { ...context, organizationProfile: { ...versions, privacyAcceptedVersion: "old" } },
    }))).toContain("Action requise");
  });

  it.each([
    { orgId: "org-one", userId: "owner-one", role: "member" },
    { orgId: "org-other", userId: "owner-one", role: "owner" },
    { orgId: "org-one", userId: "someone-else", role: "owner" },
  ])("does not prompt a user without authority in this organization: %j", (membership) => {
    expect(renderToStaticMarkup(createElement(PlatformAgreementsNotice, {
      bootstrap: { ...context, membership: [membership] },
    }))).toBe("");
  });
});
