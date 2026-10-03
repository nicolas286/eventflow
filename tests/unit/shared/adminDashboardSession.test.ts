import { describe, expect, it, vi } from "vitest";
vi.mock("@gateways/supabase/supabaseClient", () => ({ supabase: {} }));
import { createAdminDashboardStore } from "../../../src/app/modules/admin/dashboard/hooks/useAdminDashboardData";

function result(orgId: string) {
  return { loading: false, error: null, bootstrap: null, orgId, eventsOverview: null, events: [] };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("not initialized"); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("organizer dashboard session store", () => {
  it("discards A's late response and clears A on unsubscribe/session replacement", async () => {
    const pending = deferred<ReturnType<typeof result>>();
    const oldStore = createAdminDashboardStore(() => pending.promise);
    const unsubscribe = oldStore.subscribe(vi.fn());
    unsubscribe();
    const b = createAdminDashboardStore(async () => result("organization-B"));
    b.subscribe(vi.fn());
    await b.refetch();
    pending.resolve(result("organization-A"));
    await pending.promise;
    expect(oldStore.getSnapshot().orgId).toBeNull();
    expect(b.getSnapshot().orgId).toBe("organization-B");
  });

  it("clears the old org when bootstrap resolves a different org and rejects out-of-order refetches", async () => {
    const first = deferred<ReturnType<typeof result>>();
    const second = deferred<ReturnType<typeof result>>();
    let response = Promise.resolve(result("organization-A"));
    let resolveOrganization: (orgId: string | null) => void = () => undefined;
    const store = createAdminDashboardStore((_current, onOrganizationResolved) => {
      resolveOrganization = onOrganizationResolved;
      return response;
    });
    store.subscribe(vi.fn());
    await store.refetch();
    expect(store.getSnapshot().orgId).toBe("organization-A");
    response = first.promise;
    const slow = store.refetch();
    expect(store.getSnapshot().orgId).toBe("organization-A");
    response = second.promise;
    const fast = store.refetch();
    resolveOrganization("organization-B");
    // Hide A before B's dependent event request finishes.
    expect(store.getSnapshot().orgId).toBeNull();
    second.resolve(result("organization-B"));
    await fast;
    first.resolve(result("organization-A"));
    await slow;
    expect(store.getSnapshot().orgId).toBe("organization-B");
  });

  it("ignores late errors and makes obsolete bootstrap continuations detectable", async () => {
    const pending = deferred<ReturnType<typeof result>>();
    let isCurrent = () => true;
    const store = createAdminDashboardStore((current) => { isCurrent = current; return pending.promise; });
    const unsubscribe = store.subscribe(vi.fn());
    expect(isCurrent()).toBe(true);
    unsubscribe();
    expect(isCurrent()).toBe(false);
    pending.reject(new Error("old account error"));
    await pending.promise.catch(() => undefined);
    expect(store.getSnapshot().error).toBeNull();
  });

  it("does not load unauthenticated data or refetch via an obsolete callback", async () => {
    const load = vi.fn(async () => result("organization-A"));
    const disabled = createAdminDashboardStore(load, false);
    disabled.subscribe(vi.fn());
    await disabled.refetch();
    expect(load).not.toHaveBeenCalled();
    const store = createAdminDashboardStore(load);
    const unsubscribe = store.subscribe(vi.fn());
    unsubscribe();
    await store.refetch();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
