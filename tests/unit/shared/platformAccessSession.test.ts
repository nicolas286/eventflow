import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session } from "@supabase/supabase-js";
import type { PlatformAccess } from "../../../shared/schemas/platform-admin";

// Controlled component state/effects, with actual React markup rendering.
// This explicitly does not simulate a real browser or React commit scheduler.
const lifecycle = vi.hoisted(() => ({
  session: null as Session | null,
  values: [] as unknown[], cursor: 0,
  effect: undefined as (() => (() => void) | void) | undefined,
  cleanup: undefined as (() => void) | undefined,
  key: undefined as string | null | undefined,
  access: vi.fn<() => Promise<PlatformAccess>>(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = lifecycle.cursor++;
    if (lifecycle.values[index] === undefined) lifecycle.values[index] = initial;
    return [lifecycle.values[index], (value: unknown) => { lifecycle.values[index] = value; }];
  },
  useEffect: (effect: () => (() => void) | void) => { lifecycle.effect = effect; },
}));
vi.mock("@providers/AuthProvider/useAuth", () => ({ useAuth: () => ({ session: lifecycle.session, user: lifecycle.session?.user, loading: false, signOut: vi.fn() }) }));
vi.mock("../../../src/app/modules/platform/data/platformAdminRepo", () => ({ platformAdminRepo: { access: lifecycle.access } }));
vi.mock("react-router-dom", () => ({ Navigate: () => createElement("p", null, "redirect") }));
import { PlatformAccessGate } from "../../../src/app/modules/platform/auth/PlatformAccessGate";

function session(id: string, revision = 1, aal = "aal2"): Session {
  return { access_token: `header.${btoa(JSON.stringify({ session_id: `session-${id}`, revision, aal }))}.fixture`, refresh_token: "synthetic", expires_in: 3600, token_type: "bearer", user: { id, aud: "authenticated", created_at: "2026-10-02", app_metadata: {}, user_metadata: {} } };
}
function deferred() {
  let resolve: (value: PlatformAccess) => void = () => { throw new Error("not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("not initialized"); };
  const promise = new Promise<PlatformAccess>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const allowed: PlatformAccess = { isPlatformAdmin: true, sessionActive: true, aal: "aal2", mfaRequired: false };
function GateProbe() {
  const element = PlatformAccessGate({ children: createElement("p", null, "PRIVILEGED-CONTENT") });
  if (element.key !== lifecycle.key) {
    lifecycle.cleanup?.(); lifecycle.cleanup = undefined;
    lifecycle.values = []; lifecycle.key = element.key;
  }
  lifecycle.cursor = 0;
  return renderToStaticMarkup(element);
}
function commit() { lifecycle.cleanup = lifecycle.effect?.() ?? undefined; }
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => {
  lifecycle.session = session("A"); lifecycle.values = []; lifecycle.key = undefined;
  lifecycle.cleanup = lifecycle.effect = undefined; lifecycle.access.mockReset();
});

describe("platform gate session boundary (controlled component lifecycle)", () => {
  it("removes allowed A before checking unauthorized B and ignores A's late result", async () => {
    lifecycle.access.mockResolvedValue(allowed);
    GateProbe(); commit(); await settle();
    expect(GateProbe()).toContain("PRIVILEGED-CONTENT");
    const b = deferred(); lifecycle.access.mockReturnValue(b.promise);
    lifecycle.session = session("B");
    expect(GateProbe()).not.toContain("PRIVILEGED-CONTENT");
    commit();
    b.reject(new Error("unauthorized B")); await settle();
    expect(GateProbe()).toContain("Accès refusé");

    const a = deferred(); lifecycle.access.mockReturnValue(a.promise);
    lifecycle.session = session("A"); GateProbe(); commit();
    lifecycle.session = session("C"); GateProbe();
    a.resolve(allowed); await settle();
    expect(GateProbe()).not.toContain("PRIVILEGED-CONTENT");
  });

  it("keeps the same boundary on token refresh and replaces it for another session/MFA level/logout", async () => {
    lifecycle.access.mockResolvedValue(allowed);
    GateProbe(); commit(); await settle();
    const key = lifecycle.key;
    lifecycle.session = session("A", 2);
    expect(GateProbe()).toContain("PRIVILEGED-CONTENT");
    expect(lifecycle.key).toBe(key);
    expect(lifecycle.access).toHaveBeenCalledOnce();
    lifecycle.session = session("A", 3, "aal1");
    expect(GateProbe()).not.toContain("PRIVILEGED-CONTENT");
    lifecycle.session = null;
    expect(GateProbe()).not.toContain("PRIVILEGED-CONTENT");
  });
});
