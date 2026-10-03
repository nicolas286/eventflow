import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { StartSubscriptionResponse } from "../../../shared/schemas/subscriptions";

const fixture = vi.hoisted(() => ({
  provider: "manual", loading: false,
  result: null as StartSubscriptionResponse | null,
  effects: [] as Array<() => unknown>,
  showToast: vi.fn(),
}));
vi.mock("react", async (importOriginal) => {
  const original = await importOriginal<typeof import("react")>();
  return { ...original, useEffect: (effect: () => unknown) => fixture.effects.push(effect) };
});
vi.mock("@gateways/supabase/supabaseClient", () => ({ supabase: {} }));
vi.mock("@shared/ui/components/toast/useToast", () => ({ useToast: () => ({ showToast: fixture.showToast }) }));
vi.mock("../../../src/app/modules/admin/subscriptions/hooks/useStartSubscription", () => ({
  useStartSubscription: () => ({ loading: false, error: null, result: fixture.result, reset: vi.fn(), startSubscription: vi.fn() }),
}));
vi.mock("../../../src/app/modules/admin/subscriptions/hooks/useCancelSubscription", () => ({
  useCancelSubscription: () => ({ loading: fixture.loading, error: null, reset: vi.fn(), cancelSubscription: vi.fn() }),
}));
vi.mock("../../../src/app/modules/admin/subscriptions/hooks/useMakeOrganizationBilling", () => ({
  useMakeOrganizationBilling: () => ({ loading: false, error: null, billing: null, fetchBilling: vi.fn(), reset: vi.fn(), isCurrentScope: () => true }),
}));
vi.mock("../../../src/app/modules/admin/subscriptions/hooks/useUpsertOrganizationBilling", () => ({
  useUpsertOrganizationBilling: () => ({ loading: false, error: null, updated: null, upsertOrganizationBilling: vi.fn(), reset: vi.fn(), isCurrentScope: () => true }),
}));
vi.mock("react-router-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...original,
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
    useOutletContext: () => ({
      orgId: "10000000-0000-4000-8000-000000000001", refetch: vi.fn(),
      bootstrap: {
        organization: { plan: "pro", status: "active", planStartedAt: "2026-09-01T00:00:00Z" },
        subscription: { provider: fixture.provider, status: "active", currentPeriodEnd: "2026-10-01T00:00:00Z" },
        planLimits: {},
      },
    }),
  };
});
import AdminSubscriptionPage from "../../../src/app/modules/admin/subscriptions/pages/AdminSubscriptionPage";

afterEach(() => {
  fixture.provider = "manual";
  fixture.loading = false;
  fixture.result = null;
  fixture.effects = [];
  fixture.showToast.mockClear();
});

describe("manual subscription cancellation action", () => {
  it("offers cancellation for an active manual subscription", () => {
    const html = renderToStaticMarkup(createElement(AdminSubscriptionPage));
    expect(html).toMatch(/<button\b[^>]*>Résilier l’abonnement<\/button>/u);
    expect(html).not.toContain('role="dialog"');
  });

  it("disables the cancellation button during the request", () => {
    fixture.loading = true;
    const html = renderToStaticMarkup(createElement(AdminSubscriptionPage));
    expect(html).toMatch(/<button\b[^>]*disabled=""[^>]*>Résilier l’abonnement<\/button>/u);
  });

  it("does not promise cancellation of a legacy Mollie subscription", () => {
    fixture.provider = "mollie";
    const html = renderToStaticMarkup(createElement(AdminSubscriptionPage));
    expect(html).not.toContain("Résilier l’abonnement");
    expect(html).not.toContain("résilier votre abonnement à tout");
  });
});

describe("subscription activation warnings", () => {
  it.each([
    ["INVOICE_PDF_PENDING", "Le PDF est en préparation"],
    ["BILLIT_SEND_PENDING", "La transmission comptable reste à réessayer"],
    ["BILLIT_REVIEW_REQUIRED", "La transmission comptable doit être vérifiée avant un nouvel envoi"],
  ])("keeps activation successful while explaining %s", (warning, description) => {
    fixture.result = {
      ok: true, action: "invoice", provider: "manual", orgId: "10000000-0000-4000-8000-000000000001",
      plan: "pro", status: "active", invoiceId: "20000000-0000-4000-8000-000000000002", invoiceNumber: "FIXTURE-001",
      dueAt: "2026-10-13T00:00:00Z", currentPeriodEnd: "2026-10-29T00:00:00Z", reused: false,
      promoApplied: false, discountPercent: null, billingPriceValue: "25.99", warnings: [warning],
    };
    renderToStaticMarkup(createElement(AdminSubscriptionPage));
    for (const effect of fixture.effects) effect();
    expect(fixture.showToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Abonnement actif, facture en cours de traitement",
      variant: "warning",
      description: expect.stringContaining(description),
    }));
    expect(fixture.showToast.mock.calls[0][0].description).not.toContain(warning);
  });
});
