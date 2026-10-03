import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

// Controlled hook lifecycle: exercises the real request/render logic, not a
// browser mount. Browser/React scheduling remains a separate acceptance check.
const harness = vi.hoisted(() => ({
  session: null as Session | null,
  value: undefined as unknown,
  refs: [] as { current: unknown }[],
  refCursor: 0,
  callbackCursor: 0,
  effectCursor: 0,
  callbacks: [] as { deps: unknown[]; callback: () => unknown }[],
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
}));
const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    if (harness.value === undefined) harness.value = initial;
    return [harness.value, (value: unknown) => { harness.value = value; }];
  },
  useRef: (initial: unknown) => {
    const index = harness.refCursor++;
    harness.refs[index] ??= { current: initial };
    return harness.refs[index];
  },
  useCallback: (callback: () => unknown, deps: unknown[]) => {
    const index = harness.callbackCursor++;
    if (!harness.callbacks[index] || !same(harness.callbacks[index].deps, deps)) {
      harness.callbacks[index] = { deps, callback };
    }
    return harness.callbacks[index].callback;
  },
  useEffect: (effect: () => (() => void) | void, deps: unknown[]) => {
    const index = harness.effectCursor++;
    const previous = harness.effects[index];
    if (!previous || !same(previous.deps, deps)) {
      harness.pending.push(() => {
        previous?.cleanup?.();
        harness.effects[index] = { deps, cleanup: effect() ?? undefined };
      });
    }
  },
}));
vi.mock("@providers/AuthProvider/useAuth", () => ({ useAuth: () => ({ session: harness.session }) }));
import { usePlatformQuery } from "../../../src/app/modules/platform/hooks/usePlatformQuery";

function session(id: string, revision = 1): Session {
  return {
    access_token: `header.${btoa(JSON.stringify({ session_id: `session-${id}`, revision }))}.fixture`,
    refresh_token: `synthetic-${revision}`, token_type: "bearer", expires_in: 3600,
    user: { id, aud: "authenticated", created_at: "2026-10-02", app_metadata: {}, user_metadata: {} },
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("not initialized"); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function QueryProbe(load: () => Promise<string>, key = "org-A") {
  harness.refCursor = harness.callbackCursor = harness.effectCursor = 0;
  return usePlatformQuery(load, key);
}
function commit() { for (const effect of harness.pending.splice(0)) effect(); }
async function settle() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => {
  harness.session = session("A"); harness.value = undefined;
  harness.refs = []; harness.callbacks = []; harness.effects = []; harness.pending = [];
});

describe("platform identity/org query lifecycle (controlled hooks)", () => {
  it("masks loaded A before B's effects and discards late responses from A", async () => {
    const slowA = deferred<string>();
    const loadA = vi.fn(async () => "data-A");
    let query = QueryProbe(loadA); commit(); await settle();
    expect(QueryProbe(loadA).data).toBe("data-A");
    query = QueryProbe(() => slowA.promise); commit();
    const oldReload = query.reload;
    const oldRequest = oldReload();
    harness.session = session("B");
    const loadB = vi.fn(async () => "data-B");
    expect(QueryProbe(loadB).data).toBeNull(); // before cleanup/effect
    commit(); await settle();
    slowA.resolve("late-data-A"); await oldRequest;
    expect(QueryProbe(loadB).data).toBe("data-B");
    await oldReload();
    expect(loadB).toHaveBeenCalledOnce();
  });

  it("clears the old org and preserves rejection of out-of-order organization responses", async () => {
    const slow = deferred<string>();
    QueryProbe(() => slow.promise, "org-A"); commit();
    const loadB = async () => "organization-B";
    expect(QueryProbe(loadB, "org-B").data).toBeNull();
    commit(); await settle();
    slow.resolve("organization-A"); await settle();
    expect(QueryProbe(loadB, "org-B").data).toBe("organization-B");
  });

  it("keeps data and avoids automatic reload on token refresh for the same session", async () => {
    const load = vi.fn(async () => "current-data");
    QueryProbe(load); commit(); await settle();
    harness.session = session("A", 2);
    expect(QueryProbe(load).data).toBe("current-data");
    commit(); await settle();
    expect(load).toHaveBeenCalledOnce();
  });

  it("clears logout immediately, rejects old errors and does not load without a session", async () => {
    const slow = deferred<string>();
    const load = vi.fn(() => slow.promise);
    QueryProbe(load); commit();
    harness.session = null;
    expect(QueryProbe(load)).toMatchObject({ data: null, error: null, loading: false });
    commit();
    slow.reject(new Error("old-identity-error")); await settle();
    expect(QueryProbe(load)).toMatchObject({ data: null, error: null });
    expect(load).toHaveBeenCalledOnce();
  });

  it("only accepts the latest manual reload of the same session/org", async () => {
    let next = Promise.resolve("initial");
    const load = () => next;
    const query = QueryProbe(load); commit(); await settle();
    const first = deferred<string>(); const second = deferred<string>();
    next = first.promise; const p1 = query.reload();
    next = second.promise; const p2 = query.reload();
    second.resolve("newest"); await p2;
    first.resolve("oldest"); await p1;
    expect(QueryProbe(load).data).toBe("newest");
  });
});
