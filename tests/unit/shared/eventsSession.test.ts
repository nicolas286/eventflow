import { describe, expect, it, vi } from "vitest";
import { createScopedEventMutationStore } from "../../../src/app/modules/admin/singleEvent/hooks/useScopedEventMutation";
import { createAdminSingleEventCoreStore } from "../../../src/app/modules/admin/singleEvent/hooks/useAdminSingleEventCoreData";

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function core(eventId: string) { return { eventId, data: null }; }

describe("event detail scoped cache", () => {
  it("keeps the current event while reloading the same scope and rejects out-of-order data", async () => {
    const first = deferred<ReturnType<typeof core>>();
    const second = deferred<ReturnType<typeof core>>();
    let response = Promise.resolve(core("event-A"));
    const store = createAdminSingleEventCoreStore(() => response);
    store.subscribe(vi.fn());
    await store.refetch();
    expect(store.getSnapshot().eventId).toBe("event-A");
    response = first.promise;
    const slow = store.refetch();
    expect(store.getSnapshot().eventId).toBe("event-A");
    response = second.promise;
    const fast = store.refetch();
    second.resolve(core("event-B"));
    await fast;
    first.resolve(core("event-A"));
    await slow;
    expect(store.getSnapshot().eventId).toBe("event-B");
  });

  it("clears data on unsubscribe and ignores late errors and obsolete reload callbacks", async () => {
    const pending = deferred<ReturnType<typeof core>>();
    const load = vi.fn(() => pending.promise);
    const store = createAdminSingleEventCoreStore(load);
    const unsubscribe = store.subscribe(vi.fn());
    const request = store.refetch();
    unsubscribe();
    expect(store.isCurrentScope()).toBe(false);
    pending.reject(new Error("Old scope error"));
    await request;
    await store.refetch();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()).toMatchObject({ eventId: null, data: null, error: null });
  });

  it("does not load without an authenticated complete event scope", async () => {
    const load = vi.fn(async () => core("event-A"));
    const store = createAdminSingleEventCoreStore(load, false);
    store.subscribe(vi.fn());
    await store.refetch();
    expect(load).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ loading: false, eventId: null, data: null });
  });
});

describe("event mutation scoped store", () => {
  it("returns no old mutation DTO after replacement/unsubscribe and exposes an empty cache", async () => {
    const response = deferred<string>();
    const old = createScopedEventMutationStore(() => response.promise, "Mutation failed");
    const unsubscribe = old.subscribe(vi.fn());
    const pending = old.mutate({ eventId: "event-A" });
    unsubscribe();
    response.resolve("event-A");
    await expect(pending).resolves.toBeNull();
    expect(old.getSnapshot()).toEqual({ loading: false, error: null, result: null });
    expect(old.isCurrentScope()).toBe(false);
    const next = createScopedEventMutationStore(async () => "event-B", "Mutation failed");
    next.subscribe(vi.fn());
    await expect(next.mutate({ eventId: "event-B" })).resolves.toBe("event-B");
    expect(next.getSnapshot().result).toBe("event-B");
  });

  it("reset and a newer request invalidate late success and error responses", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const store = createScopedEventMutationStore((input: number) => input === 1 ? first.promise : second.promise, "Mutation failed");
    store.subscribe(vi.fn());
    const old = store.mutate(1);
    const next = store.mutate(2);
    second.resolve("event-B");
    await next;
    first.reject(new Error("Old account error"));
    await expect(old).resolves.toBeNull();
    expect(store.getSnapshot()).toEqual({ loading: false, error: null, result: "event-B" });
    const resetResponse = deferred<string>();
    const resetStore = createScopedEventMutationStore(() => resetResponse.promise, "Mutation failed");
    resetStore.subscribe(vi.fn());
    const resetRequest = resetStore.mutate(undefined);
    resetStore.reset();
    resetResponse.resolve("event-A");
    await expect(resetRequest).resolves.toBeNull();
    expect(resetStore.getSnapshot()).toEqual({ loading: false, error: null, result: null });
  });

  it("prevents mutations from unauthenticated or obsolete callbacks", async () => {
    const load = vi.fn(async () => "event-A");
    const disabled = createScopedEventMutationStore(load, "Mutation failed", false);
    disabled.subscribe(vi.fn());
    await expect(disabled.mutate(undefined)).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
