import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signOutFromBrowser } from "../../../src/shared/gateways/supabase/signOutFromBrowser";

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn() }));
vi.mock("../../../src/shared/gateways/supabase/supabaseClient", () => ({
  supabase: { auth: { signOut } },
}));

const key = "sb-staging-project-auth-token";
let stores: Map<string, string>[];
let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VITE_SUPABASE_URL", "https://staging-project.supabase.co");
  stores = [new Map(), new Map()];
  for (const store of stores) {
    for (const suffix of ["", "-code-verifier", "-user"]) store.set(key + suffix, "stale");
    store.set("theme", "dark");
    store.set("sb-other-project-auth-token", "other");
  }
  replace = vi.fn();
  vi.stubGlobal("window", {
    localStorage: { removeItem: (name: string) => stores[0].delete(name) },
    sessionStorage: { removeItem: (name: string) => stores[1].delete(name) },
    location: { replace },
  });
  signOut.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function expectLocalLogout() {
  for (const store of stores) {
    expect([...store.entries()]).toEqual([
      ["theme", "dark"], ["sb-other-project-auth-token", "other"],
    ]);
  }
  expect(replace).toHaveBeenCalledWith("/admin/login");
  expect(vi.getTimerCount()).toBe(0);
}

describe("browser logout", () => {
  it("clears both session stores after successful remote logout", async () => {
    signOut.mockResolvedValue({ error: null });
    await signOutFromBrowser();
    expect(signOut).toHaveBeenCalledOnce();
    expectLocalLogout();
  });

  it("leaves a revoked session when Supabase returns an error", async () => {
    signOut.mockResolvedValue({ error: new Error("Invalid Refresh Token") });
    await signOutFromBrowser();
    expectLocalLogout();
  });

  it("still leaves when the logout request rejects", async () => {
    signOut.mockRejectedValue(new Error("Network unavailable"));
    await signOutFromBrowser();
    expectLocalLogout();
  });

  it("leaves after five seconds when the SDK is stuck", async () => {
    signOut.mockImplementation(() => new Promise(() => {}));
    const logout = signOutFromBrowser();
    await vi.advanceTimersByTimeAsync(4999);
    expect(replace).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await logout;
    expectLocalLogout();
  });
});
