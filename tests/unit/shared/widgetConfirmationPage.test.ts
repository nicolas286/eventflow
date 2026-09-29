import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrderPublicResponse } from "../../../shared/schemas/orders-read";

const state = vi.hoisted(() => ({
  order: null as OrderPublicResponse | null,
  error: null as string | null,
  loading: false,
  refresh: vi.fn(),
}));
vi.mock("@gateways/supabase/supabaseClient", () => ({ supabase: {} }));
vi.mock("../../../src/app/modules/public/widget/hooks/useWidgetConfirmationOrder", () => ({
  useWidgetConfirmationOrder: () => state,
}));
vi.mock("../../../src/app/modules/public/widget/hooks/useWidgetAutoResize", () => ({ useWidgetAutoResize: () => {} }));
vi.mock("react-router-dom", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...original,
    useNavigate: () => vi.fn(),
    useParams: () => ({ orgSlug: "fixture-org", eventSlug: "fixture-event" }),
    useLocation: () => ({ search: "" }),
    useSearchParams: () => [new URLSearchParams(), vi.fn()],
  };
});
import WidgetConfirmationPage from "../../../src/app/modules/public/widget/pages/WidgetConfirmationPage";

const orderId = "10000000-0000-4000-8000-000000000001";
const cached = {
  orderId, bookingToken: "synthetic-token", buyerEmail: "buyer@example.invalid", eventTitle: "Fixture event",
  totalTickets: 1, status: "awaiting_payment", totalCents: 1000,
  bankTransfer: { iban: "OBSOLETE-CACHE-IBAN" },
};
const instructions = {
  beneficiary: "Current beneficiary", iban: "BE68539007547034", amountCents: 1500,
  currency: "EUR", communication: "CURRENT-COMMUNICATION", internalReference: "CURRENT-REF", paymentDueAt: null,
};

function render() {
  vi.stubGlobal("sessionStorage", { getItem: () => JSON.stringify(cached) });
  return renderToStaticMarkup(createElement(WidgetConfirmationPage));
}

afterEach(() => {
  state.order = null;
  state.error = null;
  state.loading = false;
  vi.unstubAllGlobals();
});

describe("widget confirmation renders server state only", () => {
  it("shows current server instructions for a payable transfer, not cached instructions", () => {
    state.order = { id: orderId, status: "awaiting_payment", totalCents: 1500, currency: "EUR", paymentStatus: "pending", paymentMethod: "bank_transfer", bankTransfer: instructions };
    const html = render();
    expect(html).toContain("Instructions de virement");
    expect(html).toContain(instructions.iban);
    expect(html).toContain(instructions.communication);
    expect(html).not.toContain("OBSOLETE-CACHE-IBAN");
    expect(html).toContain("Actualiser le statut");
  });

  it.each(["paid", "partially_paid", "expired", "canceled", "cancelled", "failed", "pending"] as const)("never shows transfer instructions for server status %s", (status) => {
    state.order = { id: orderId, status, totalCents: 1500, currency: "EUR", paymentStatus: "pending", paymentMethod: "bank_transfer", bankTransfer: instructions };
    const html = render();
    expect(html).not.toContain("Instructions de virement");
    expect(html).not.toContain(instructions.iban);
    expect(html).not.toContain("OBSOLETE-CACHE-IBAN");
    if (status === "paid" || status === "partially_paid") expect(html).toContain("Réservation confirmée");
    if (status === "expired") expect(html).toContain("Réservation expirée");
  });

  it("hides cached payment details while verifying the order", () => {
    state.loading = true;
    const html = render();
    expect(html).toContain("Chargement de votre commande");
    expect(html).not.toContain("Instructions de virement");
    expect(html).not.toContain("OBSOLETE-CACHE-IBAN");
  });

  it("shows an error and retry instead of falling back to cached awaiting-payment state", () => {
    state.error = "Impossible de vérifier votre réservation.";
    const html = render();
    expect(html).toContain(state.error);
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("Instructions de virement");
    expect(html).not.toContain("OBSOLETE-CACHE-IBAN");
    expect(html).not.toContain("Commande enregistrée");
  });

  it("never combines another order with cached buyer or event details", () => {
    state.order = { id: "20000000-0000-4000-8000-000000000002", status: "paid", totalCents: 1500, currency: "EUR", paymentStatus: "paid" };
    const html = render();
    expect(html).not.toContain(cached.buyerEmail);
    expect(html).not.toContain(cached.eventTitle);
  });
});
