import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

// Controlled hook lifecycle runs the real page's fetch and timer logic.
// Browser layout and React scheduling are separate acceptance checks.
const harness = vi.hoisted(() => ({
  values: new Array<unknown>(), refs: new Array<{ current: unknown }>(),
  stateCursor: 0, refCursor: 0, effects: new Array<() => (() => void)>(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.stateCursor++;
    harness.values[index] ??= initial;
    return [harness.values[index], (value: unknown) => { harness.values[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = harness.refCursor++;
    harness.refs[index] ??= { current: initial };
    return harness.refs[index];
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (callback: () => unknown) => callback(),
  useEffect: (effect: () => (() => void)) => { harness.effects.push(effect); },
}));
vi.mock("react-router-dom", () => ({
  useParams: () => ({ orderId: "10000000-0000-4000-8000-000000000001" }),
  useSearchParams: () => [new URLSearchParams("token=synthetic-private-token&return=1")],
  useNavigate: () => vi.fn(), Navigate: () => null,
}));
vi.mock("@gateways/supabase/supabaseClient", () => ({ supabase: {} }));
vi.mock("@app/modules/public/events/hooks/usePublicEventDetail", () => ({
  usePublicEventDetail: () => ({ loading: false, data: null }),
}));
import { OrderPage } from "../../../src/app/modules/public/register/pages/OrderPage";

let cleanup: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setInterval, clearInterval, setTimeout, clearTimeout });
  harness.values = []; harness.refs = []; harness.effects = [];
  harness.stateCursor = harness.refCursor = 0;
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });

function start() {
  OrderPage();
  cleanup = harness.effects[0]?.();
}
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
function paid() {
  return new Response(JSON.stringify({
    id: "10000000-0000-4000-8000-000000000001", status: "paid", paymentStatus: "paid", totalCents: 100, currency: "EUR",
  }));
}
describe("return payment polling", () => {
  it.each([429, 503])("pauses HTTP %s requests until Retry-After then resumes normally", async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: status === 429 ? "TOO_MANY_REQUESTS" : "RATE_LIMIT_UNAVAILABLE" }), {
        status, headers: { "Retry-After": "5" },
      }))
      .mockResolvedValue(paid());
    vi.stubGlobal("fetch", fetch);
    start();
    await vi.advanceTimersByTimeAsync(4500);
    expect(fetch).toHaveBeenCalledOnce();
    expect(harness.values[2]).toContain("Réessayez dans 5 secondes");
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(harness.values[2]).toBeNull();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not overlap an initial read with polling while the request is pending", async () => {
    let resolve: (response: Response) => void = () => { throw new Error("not initialized"); };
    const pending = new Promise<Response>((done) => { resolve = done; });
    const fetch = vi.fn<typeof globalThis.fetch>().mockReturnValue(pending);
    vi.stubGlobal("fetch", fetch);
    start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetch).toHaveBeenCalledOnce();
    resolve(paid());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("honors a cooldown beyond the polling deadline, including a manual retry", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "40" } }))
      .mockResolvedValue(paid());
    vi.stubGlobal("fetch", fetch);
    start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledOnce();
    harness.stateCursor = harness.refCursor = 0;
    const click = firstClick(OrderPage());
    expect(click).toBeTypeOf("function");
    await click?.();
    expect(fetch).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledOnce();
    await click?.();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
