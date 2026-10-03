import { beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({ selectPersistence: vi.fn(), signInWithPassword: vi.fn(), signOut: vi.fn(), setSession: vi.fn() }));
vi.mock("@gateways/supabase/supabaseClient", () => ({
  supabase: { auth: { signInWithPassword: sdk.signInWithPassword, signOut: sdk.signOut, setSession: sdk.setSession } },
  authStorage: { selectPersistence: sdk.selectPersistence },
}));
vi.mock("@gateways/supabase/signOutFromBrowser", () => ({ signOutFromBrowser: vi.fn() }));
import { authRepo } from "../../../src/app/modules/admin/auth/data/authRepo";
beforeEach(() => {
  vi.clearAllMocks(); sdk.signOut.mockResolvedValue({ error: null }); sdk.signInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
});
describe("login persistence orchestration", () => {
  it.each([false, true])("selects persistence=%s before emitting local logout and uses the singleton", async (rememberMe) => {
    const order: string[] = [];
    sdk.selectPersistence.mockImplementation(() => { order.push("storage"); });
    sdk.signOut.mockImplementation(async () => { order.push("logout"); return { error: null }; });
    sdk.signInWithPassword.mockImplementation(async () => { order.push("login"); return { error: null }; });
    await authRepo.signIn({ email: "fixture@example.invalid", password: "SyntheticPassword123!" }, { rememberMe });
    expect(sdk.selectPersistence).toHaveBeenCalledWith(rememberMe);
    expect(sdk.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(order).toEqual(["storage", "logout", "login"]);
    expect(sdk.setSession).not.toHaveBeenCalled();
  });
  it("defaults to session-only and propagates an Auth error without restoring the old account", async () => {
    sdk.signInWithPassword.mockResolvedValue({ error: new Error("invalid credentials") });
    await expect(authRepo.signIn({ email: "fixture@example.invalid", password: "SyntheticPassword123!" })).rejects.toBeDefined();
    expect(sdk.selectPersistence).toHaveBeenCalledWith(false);
    expect(sdk.setSession).not.toHaveBeenCalled();
  });
  it("does not change storage for invalid form input", async () => {
    await expect(authRepo.signIn({ email: "invalid", password: "" })).rejects.toBeDefined();
    expect(sdk.selectPersistence).not.toHaveBeenCalled();
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
  });
});
