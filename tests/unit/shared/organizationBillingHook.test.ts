import { createClient, type Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationBilling } from "../../../shared/schemas/organization-billing";

const lifecycle = vi.hoisted((): {
  session: Session | null;
  memoCursor: number;
  memos: { dependencies: readonly unknown[]; value: unknown }[];
  subscribe: unknown;
  cleanup: (() => void) | null;
} => ({ session: null, memoCursor: 0, memos: [], subscribe: null, cleanup: null }));

// Controlled subscriptions/memo dependencies exercise the same stores as React.
// This fixture does not claim to simulate browser rendering or commit scheduling.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (callback: () => unknown, dependencies: readonly unknown[]) => {
    const index = lifecycle.memoCursor++;
    const previous = lifecycle.memos[index];
    if (!previous || dependencies.some((dependency, i) => !Object.is(dependency, previous.dependencies[i]))) {
      lifecycle.memos[index] = { dependencies, value: callback() };
    }
    return lifecycle.memos[index].value;
  },
  useSyncExternalStore: (subscribe: (callback: () => void) => () => void, snapshot: () => unknown) => {
    if (lifecycle.subscribe !== subscribe) {
      lifecycle.cleanup?.();
      lifecycle.subscribe = subscribe;
      lifecycle.cleanup = subscribe(() => undefined);
    }
    return snapshot();
  },
}));
vi.mock("@providers/AuthProvider/useAuth", () => ({ useAuth: () => ({ session: lifecycle.session }) }));

import {
  createOrganizationBillingStore,
  useMakeOrganizationBilling,
} from "../../../src/app/modules/admin/subscriptions/hooks/useMakeOrganizationBilling";
import { useUpsertOrganizationBilling } from "../../../src/app/modules/admin/subscriptions/hooks/useUpsertOrganizationBilling";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
function billing(orgId: string): OrganizationBilling {
  return {
    orgId, legalName: "Association", addressLine1: "Rue des tests 1", postalCode: "1000",
    city: "Bruxelles", countryCode: "BE", isVatValidated: false,
    createdAt: "2026-10-01", updatedAt: "2026-10-03",
  };
}
function session(userId = "user-A", revision = 1, sessionId = "session-A"): Session {
  return {
    access_token: `${btoa('{}')}.${btoa(JSON.stringify({ session_id: sessionId, revision }))}.fixture`,
    refresh_token: `fixture-refresh-${revision}`, token_type: "bearer", expires_in: 3600,
    user: { id: userId, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-03" },
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function setup() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const supabase = createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return {
    fetch,
    ReadProbe(orgId = orgA) {
      lifecycle.memoCursor = 0;
      return useMakeOrganizationBilling({ supabase, orgId });
    },
    WriteProbe(orgId = orgA) {
      lifecycle.memoCursor = 0;
      return useUpsertOrganizationBilling({ supabase, orgId });
    },
  };
}

beforeEach(() => {
  lifecycle.session = session();
  lifecycle.memoCursor = 0;
  lifecycle.memos = [];
  lifecycle.subscribe = null;
  lifecycle.cleanup = null;
});
afterEach(() => { lifecycle.cleanup?.(); });

describe("billing generation store", () => {
  it("clears a different organization immediately and discards its late data for state and caller", async () => {
    const a = deferred<OrganizationBilling | null>();
    const b = deferred<OrganizationBilling | null>();
    const store = createOrganizationBillingStore((input: { orgId: string }) => input.orgId === orgA ? a.promise : b.promise, "Load failed");
    store.subscribe(() => undefined);
    const old = store.load({ orgId: orgA });
    const current = store.load({ orgId: orgB });
    expect(store.getSnapshot()).toEqual({ loading: true, error: null, billing: null });
    b.resolve(billing(orgB));
    await expect(current).resolves.toEqual(billing(orgB));
    a.resolve(billing(orgA));
    await expect(old).resolves.toBeNull();
    expect(store.getSnapshot().billing?.orgId).toBe(orgB);
  });

  it("reset invalidates pending data and errors", async () => {
    const response = deferred<OrganizationBilling | null>();
    const store = createOrganizationBillingStore(() => response.promise, "Load failed");
    store.subscribe(() => undefined);
    const pending = store.load({ orgId: orgA });
    store.reset();
    response.resolve(billing(orgA));
    await expect(pending).resolves.toBeNull();
    expect(store.getSnapshot()).toEqual({ loading: false, error: null, billing: null });
    const failed = deferred<OrganizationBilling | null>();
    const errors = createOrganizationBillingStore(() => failed.promise, "Load failed");
    errors.subscribe(() => undefined);
    const lateError = errors.load({ orgId: orgA });
    errors.reset();
    failed.reject(new Error("Old account error"));
    await expect(lateError).resolves.toBeNull();
    expect(errors.getSnapshot().error).toBeNull();
  });

  it("ignores a late error after the new organization succeeds", async () => {
    const a = deferred<OrganizationBilling | null>();
    const store = createOrganizationBillingStore((input: { orgId: string }) => input.orgId === orgA ? a.promise : Promise.resolve(billing(orgB)), "Load failed");
    store.subscribe(() => undefined);
    const old = store.load({ orgId: orgA });
    await store.load({ orgId: orgB });
    a.reject(new Error("Old account error"));
    await expect(old).resolves.toBeNull();
    expect(store.getSnapshot()).toEqual({ loading: false, error: null, billing: billing(orgB) });
  });

  it("rejects an organization mismatch in a response and disables obsolete callbacks", async () => {
    const load = vi.fn(async () => billing(orgB));
    const store = createOrganizationBillingStore(load, "Load failed", true, orgA);
    const unsubscribe = store.subscribe(() => undefined);
    await expect(store.load({ orgId: orgB })).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
    await expect(store.load({ orgId: orgA })).resolves.toBeNull();
    expect(store.getSnapshot().billing).toBeNull();
    expect(store.getSnapshot().error).toBe("Load failed");
    unsubscribe();
    await store.load({ orgId: orgA });
    expect(load).toHaveBeenCalledOnce();
  });
});

describe("billing read hook with Edge responses and session scopes", () => {
  it("exposes loading, loaded, empty, error and recovery states", async () => {
    const { fetch, ReadProbe } = setup();
    const response = deferred<Response>();
    fetch.mockImplementationOnce(() => response.promise);
    const pending = ReadProbe().fetchBilling(orgA);
    expect(ReadProbe()).toMatchObject({ loading: true, error: null, billing: null });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    response.resolve(json({ billing: billing(orgA) }));
    await expect(pending).resolves.toEqual(billing(orgA));
    expect(ReadProbe()).toMatchObject({ loading: false, error: null, billing: billing(orgA) });
    fetch.mockResolvedValueOnce(json({ billing: null }));
    await expect(ReadProbe().fetchBilling(orgA)).resolves.toBeNull();
    expect(ReadProbe().billing).toBeNull();
    fetch.mockResolvedValueOnce(json({ error: "FORBIDDEN" }, 403));
    await ReadProbe().fetchBilling(orgA);
    expect(ReadProbe()).toMatchObject({ loading: false, billing: null });
    expect(ReadProbe().error).toBeTruthy();
    fetch.mockResolvedValueOnce(json({ billing: billing(orgA) }));
    await ReadProbe().fetchBilling(orgA);
    expect(ReadProbe()).toMatchObject({ loading: false, error: null, billing: billing(orgA) });
    ReadProbe().reset();
    expect(ReadProbe()).toMatchObject({ loading: false, error: null, billing: null });
  });

  it("hides old cached data immediately when the organization changes", async () => {
    const { fetch, ReadProbe } = setup();
    fetch.mockResolvedValueOnce(json({ billing: billing(orgA) }));
    await ReadProbe(orgA).fetchBilling(orgA);
    const oldFetch = ReadProbe(orgA).fetchBilling;
    expect(ReadProbe(orgB)).toMatchObject({ loading: false, error: null, billing: null });
    await expect(oldFetch(orgA)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("discards A's pending data after replacing the session with B", async () => {
    const { fetch, ReadProbe } = setup();
    const response = deferred<Response>();
    fetch.mockImplementationOnce(() => response.promise);
    const pending = ReadProbe().fetchBilling(orgA);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    lifecycle.session = session("user-B", 1, "session-B");
    expect(ReadProbe()).toMatchObject({ billing: null, error: null, loading: false });
    response.resolve(json({ billing: billing(orgA) }));
    await expect(pending).resolves.toBeNull();
    expect(ReadProbe().billing).toBeNull();
  });

  it("keeps refreshed JWT cache identity but clears a new session of the same user", async () => {
    const { fetch, ReadProbe } = setup();
    fetch.mockResolvedValueOnce(json({ billing: billing(orgA) }));
    await ReadProbe().fetchBilling(orgA);
    lifecycle.session = session("user-A", 2);
    expect(ReadProbe().billing).toEqual(billing(orgA));
    lifecycle.session = session("user-A", 3, "new-session-A");
    expect(ReadProbe().billing).toBeNull();
  });

  it("disables requests and clears cached billing on sign-out", async () => {
    const { fetch, ReadProbe } = setup();
    fetch.mockResolvedValueOnce(json({ billing: billing(orgA) }));
    await ReadProbe().fetchBilling(orgA);
    lifecycle.session = null;
    expect(ReadProbe().billing).toBeNull();
    await expect(ReadProbe().fetchBilling(orgA)).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([429, 503])("preserves human retry errors for HTTP %s", async (status) => {
    const { fetch, ReadProbe } = setup();
    fetch.mockResolvedValueOnce(json({ error: status === 429 ? "TOO_MANY_REQUESTS" : "RATE_LIMIT_UNAVAILABLE" }, status, { "Retry-After": "7" }));
    await ReadProbe().fetchBilling(orgA);
    expect(ReadProbe()).toMatchObject({ loading: false, billing: null });
    expect(ReadProbe().error).toContain("Réessayez dans 7 secondes");
  });
});

describe("billing save hook", () => {
  it("returns no stale saved DTO to subscription continuations after a session change", async () => {
    const { fetch, WriteProbe } = setup();
    const response = deferred<Response>();
    fetch.mockImplementationOnce(() => response.promise);
    const pending = WriteProbe().upsertOrganizationBilling({ orgId: orgA, city: "Namur" });
    expect(WriteProbe()).toMatchObject({ loading: true, updated: null, error: null });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    lifecycle.session = session("user-B", 1, "session-B");
    expect(WriteProbe()).toMatchObject({ loading: false, updated: null, error: null });
    response.resolve(json(billing(orgA)));
    await expect(pending).resolves.toBeNull();
    expect(WriteProbe().updated).toBeNull();
  });

  it("returns an updated DTO and clears it while another save runs or resets", async () => {
    const { fetch, WriteProbe } = setup();
    fetch.mockResolvedValueOnce(json(billing(orgA)));
    await expect(WriteProbe().upsertOrganizationBilling({ orgId: orgA, city: "Namur" })).resolves.toEqual(billing(orgA));
    expect(WriteProbe()).toMatchObject({ loading: false, updated: billing(orgA), error: null });
    const response = deferred<Response>();
    fetch.mockImplementationOnce(() => response.promise);
    const pending = WriteProbe().upsertOrganizationBilling({ orgId: orgA, city: "Liège" });
    expect(WriteProbe().updated).toBeNull();
    WriteProbe().reset();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    response.resolve(json(billing(orgA)));
    await expect(pending).resolves.toBeNull();
    expect(WriteProbe()).toMatchObject({ loading: false, updated: null, error: null });
  });
});
