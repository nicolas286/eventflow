import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceHistoryItem } from "../../../shared/schemas/invoice-history";

type State = {
  loading: boolean;
  error: string | null;
  items: InvoiceHistoryItem[];
  nextCursor: { id: string; issuedAt: string | null } | null;
};
const lifecycle = vi.hoisted((): { state: State | undefined } => ({ state: undefined }));

// Controlled hook state, as in the session tests. This verifies transitions,
// without claiming to simulate a browser or the React commit scheduler.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: State) => {
    lifecycle.state ??= initial;
    return [lifecycle.state, (next: State | ((previous: State) => State)) => {
      if (!lifecycle.state) throw new Error("Uninitialized hook state");
      lifecycle.state = typeof next === "function" ? next(lifecycle.state) : next;
    }];
  },
  useCallback: (callback: unknown) => callback,
  useMemo: (callback: () => unknown) => callback(),
}));
import { useMakeInvoiceList } from "../../../src/app/modules/admin/subscriptions/hooks/useMakeInvoiceList";

const orgId = "11111111-1111-4111-8111-111111111111";
const first: InvoiceHistoryItem = {
  id: "33333333-3333-4333-8333-333333333333", number: "FIX-001", status: "paid",
  issuedAt: "2026-10-02T08:00:00Z", totalCents: 1500, dueAt: null, paymentReference: null,
};
const second: InvoiceHistoryItem = { ...first, id: "44444444-4444-4444-8444-444444444444", number: "FIX-002" };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const client = createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  function InvoiceListProbe() { return useMakeInvoiceList({ supabase: client }); }
  return { fetch, render: InvoiceListProbe };
}
beforeEach(() => { lifecycle.state = undefined; });

describe("invoice history hook transitions with the Edge repository", () => {
  it("exposes loading and resolves a first page, then refreshes and resets", async () => {
    const { fetch, render } = setup();
    let complete: (response: Response) => void = () => { throw new Error("Uninitialized deferred response"); };
    fetch.mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const pending = render().fetchFirst({ orgId });
    expect(render()).toMatchObject({ loading: true, error: null, items: [], hasMore: false });
    // The SDK resolves the session before calling the controlled HTTP fetch.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    complete(json({ orgId, items: [first], nextCursor: null }));
    await expect(pending).resolves.toEqual([first]);
    expect(render()).toMatchObject({ loading: false, error: null, items: [first], hasMore: false });
    fetch.mockResolvedValueOnce(json({ orgId, items: [second], nextCursor: null }));
    await render().fetchFirst({ orgId, limit: 10 });
    expect(render().items).toEqual([second]);
    expect(fetch.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ orgId, limit: 10, cursor: null }));
    render().reset();
    expect(render()).toMatchObject({ loading: false, error: null, items: [], nextCursor: null, hasMore: false });
  });

  it("preserves the empty state and avoids fetchMore without a cursor", async () => {
    const { fetch, render } = setup();
    fetch.mockResolvedValueOnce(json({ orgId, items: [], nextCursor: null }));
    await expect(render().fetchFirst({ orgId })).resolves.toEqual([]);
    await expect(render().fetchMore({ orgId })).resolves.toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(render()).toMatchObject({ loading: false, error: null, items: [], hasMore: false });
  });

  it("appends a next page using the server cursor and then stops", async () => {
    const { fetch, render } = setup();
    const cursor = { id: first.id, issuedAt: first.issuedAt };
    fetch.mockResolvedValueOnce(json({ orgId, items: [first], nextCursor: cursor }));
    await render().fetchFirst({ orgId });
    expect(render().hasMore).toBe(true);
    fetch.mockResolvedValueOnce(json({ orgId, items: [second], nextCursor: null }));
    await expect(render().fetchMore({ orgId, limit: 10 })).resolves.toEqual([second]);
    const requestBody = fetch.mock.calls[1]?.[1]?.body;
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(requestBody)).toEqual({ orgId, limit: 10, cursor });
    expect(render()).toMatchObject({ items: [first, second], loading: false, hasMore: false });
    await expect(render().fetchMore({ orgId })).resolves.toEqual([first, second]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("clears results on first-page refusal and recovers on refresh", async () => {
    const { fetch, render } = setup();
    fetch.mockResolvedValueOnce(json({ orgId, items: [first], nextCursor: null }));
    await render().fetchFirst({ orgId });
    fetch.mockResolvedValueOnce(json({ error: "FORBIDDEN" }, 403));
    await expect(render().fetchFirst({ orgId })).resolves.toEqual([]);
    expect(render()).toMatchObject({ loading: false, items: [], nextCursor: null });
    expect(render().error).toBeTruthy();
    fetch.mockResolvedValueOnce(json({ orgId, items: [second], nextCursor: null }));
    await render().fetchFirst({ orgId });
    expect(render()).toMatchObject({ error: null, items: [second] });
  });

  it.each([429, 503])("retains the first page and cursor after HTTP %s fetchMore failure", async (status) => {
    const { fetch, render } = setup();
    const cursor = { id: first.id, issuedAt: first.issuedAt };
    fetch.mockResolvedValueOnce(json({ orgId, items: [first], nextCursor: cursor }));
    await render().fetchFirst({ orgId });
    fetch.mockResolvedValueOnce(json({ error: status === 429 ? "TOO_MANY_REQUESTS" : "RATE_LIMIT_UNAVAILABLE" }, status, { "Retry-After": "7" }));
    await expect(render().fetchMore({ orgId })).resolves.toEqual([first]);
    expect(render()).toMatchObject({ loading: false, items: [first], nextCursor: cursor, hasMore: true });
    expect(render().error).toContain("Réessayez dans 7 secondes");
    fetch.mockResolvedValueOnce(json({ orgId, items: [second], nextCursor: null }));
    await render().fetchMore({ orgId });
    expect(render()).toMatchObject({ error: null, items: [first, second], hasMore: false });
  });
});
