import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, useContext } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session } from "@supabase/supabase-js";
const lifecycle = vi.hoisted(() => ({
  values: [] as unknown[], refs: [] as { current: unknown }[], cursor: 0, refCursor: 0,
  effect: undefined as (() => (() => void)) | undefined,
  callback: undefined as ((event: string, session: Session | null) => void) | undefined,
  getSession: vi.fn<() => Promise<Session | null>>(), signOut: vi.fn<() => Promise<void>>(), unsubscribe: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = lifecycle.cursor++;
    if (lifecycle.values[index] === undefined) lifecycle.values[index] = initial;
    return [lifecycle.values[index], (value: unknown) => { lifecycle.values[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = lifecycle.refCursor++;
    lifecycle.refs[index] ??= { current: initial }; return lifecycle.refs[index];
  },
  useCallback: (callback: unknown) => callback,
  useEffect: (effect: () => (() => void)) => { lifecycle.effect = effect; },
}));
vi.mock("@shared/gateways/supabase/supabaseClient", () => ({ supabase: { auth: {
  onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
    lifecycle.callback = callback; return { data: { subscription: { unsubscribe: lifecycle.unsubscribe } } };
  },
} } }));
vi.mock("@app/modules/admin/auth/data/authRepo", () => ({ authRepo: { getSession: lifecycle.getSession, signOut: lifecycle.signOut } }));
import { AuthProvider } from "../../../src/app/providers/AuthProvider/AuthProvider";
import { AuthContext, type AuthContextValue } from "../../../src/app/providers/AuthProvider/AuthContext";

function ContextProbe({ observe }: { observe: (value: AuthContextValue | undefined) => void }) {
  observe(useContext(AuthContext)); return null;
}
function ProviderProbe() {
  let captured: AuthContextValue | undefined;
  lifecycle.cursor = lifecycle.refCursor = 0;
  renderToStaticMarkup(createElement(AuthProvider, null, createElement(ContextProbe, { observe: (value) => { captured = value; } })));
  if (!captured) throw new Error("Missing AuthContext");
  return captured;
}
function deferred() {
  let resolve: (value: Session | null) => void = () => { throw new Error("not initialized"); };
  const promise = new Promise<Session | null>((yes) => { resolve = yes; });
  return { promise, resolve };
}
function session(id: string): Session {
  return { access_token: "synthetic", refresh_token: "synthetic", expires_in: 3600, token_type: "bearer", user: { id, aud: "authenticated", created_at: "2026-10-02", app_metadata: {}, user_metadata: {} } };
}
async function settle() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => {
  lifecycle.values = []; lifecycle.refs = []; lifecycle.callback = lifecycle.effect = undefined;
  lifecycle.getSession.mockReset(); lifecycle.signOut.mockResolvedValue();
});
describe("AuthProvider session transitions (controlled hooks)", () => {
  it("does not let a late bootstrap restore A after B's Auth event", async () => {
    const pending = deferred(); lifecycle.getSession.mockReturnValue(pending.promise);
    ProviderProbe(); lifecycle.effect?.();
    lifecycle.callback?.("SIGNED_IN", session("B"));
    pending.resolve(session("A")); await settle();
    expect(ProviderProbe().user?.id).toBe("B");
    expect(ProviderProbe().loading).toBe(false);
  });
  it("rejects bootstrap results of a cleaned-up effect, including StrictMode replay", async () => {
    const first = deferred(); const second = deferred();
    lifecycle.getSession.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    ProviderProbe(); const cleanup = lifecycle.effect?.(); cleanup?.();
    ProviderProbe(); lifecycle.effect?.();
    second.resolve(session("B")); await settle();
    first.resolve(session("A")); await settle();
    expect(ProviderProbe().user?.id).toBe("B");
  });
  it("clears logout before remote completion and ignores a subsequent refresh notification", async () => {
    lifecycle.getSession.mockResolvedValue(session("A"));
    ProviderProbe(); lifecycle.effect?.(); await settle();
    const context = ProviderProbe(); expect(context.user?.id).toBe("A");
    let finish: () => void = () => { throw new Error("not initialized"); };
    lifecycle.signOut.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const pending = context.signOut();
    expect(ProviderProbe().session).toBeNull();
    lifecycle.callback?.("TOKEN_REFRESHED", session("A"));
    expect(ProviderProbe().session).toBeNull();
    expect(ProviderProbe().user).toBeNull();
    finish(); await pending;
  });
});
