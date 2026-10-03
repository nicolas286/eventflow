import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { EdgeRequestError } from "../../../src/shared/errors/edgeRequestError";

type Harness = {
  error: unknown;
  retryAt: { current: number };
  download: Mock<() => Promise<{ url: string }>>;
};
const harness = vi.hoisted((): Harness => ({
  error: null, retryAt: { current: 0 },
  download: vi.fn<() => Promise<{ url: string }>>(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: () => [harness.error, (value: unknown) => { harness.error = value; }],
  useRef: () => harness.retryAt,
  useMemo: (callback: () => unknown) => callback(),
  useEffect: () => undefined,
}));
vi.mock("@gateways/supabase/supabaseClient", () => ({ supabase: {} }));
vi.mock("@app/modules/admin/subscriptions/data/makeInvoicePdfUrlRepo", () => ({
  invoicePdfRepo: () => ({ getPdfUrl: harness.download }),
}));
vi.mock("@app/modules/admin/subscriptions/hooks/useMakeInvoiceList", () => ({
  useMakeInvoiceList: () => ({ items: [{ id: "fixture-invoice", number: "FIX-001", status: "paid", totalCents: 100 }], loading: false, error: null }),
}));
import { InvoicesTab } from "../../../src/app/modules/admin/subscriptions/components/InvoicesTab";

function firstClick(node: ReactNode): (() => unknown) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const click = firstClick(child);
      if (click) return click;
    }
  }
  if (isValidElement<{ children?: ReactNode; onClick?: () => unknown }>(node)) {
    return node.props.onClick ?? firstClick(node.props.children);
  }
}
beforeEach(() => {
  vi.useFakeTimers(); harness.error = null; harness.retryAt.current = 0; harness.download.mockReset();
  vi.stubGlobal("window", { open: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("invoice PDF rate limit feedback (controlled hooks)", () => {
  it.each([429, 503] as const)("shows HTTP %s safely and blocks repeat clicks until Retry-After", async (status) => {
    harness.download.mockRejectedValueOnce(new EdgeRequestError(status, 7)).mockResolvedValue({ url: "https://fixture.example.invalid/pdf" });
    const click = firstClick(InvoicesTab({ orgId: "fixture-org" }));
    expect(click).toBeTypeOf("function");
    await click?.();
    expect(harness.error).toContain("Réessayez dans 7 secondes");
    await click?.();
    expect(harness.download).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(7000);
    await click?.();
    expect(harness.download).toHaveBeenCalledTimes(2);
    expect(harness.error).toBeNull();
  });
  it("never logs or displays the raw failure of a PDF request", async () => {
    const logs = vi.spyOn(console, "error");
    harness.download.mockRejectedValue(new Error("synthetic-private-response"));
    await firstClick(InvoicesTab({ orgId: "fixture-org" }))?.();
    expect(harness.error).toBe("Impossible de télécharger la facture. Réessayez dans quelques instants.");
    expect(logs).not.toHaveBeenCalled();
    logs.mockRestore();
  });
});
