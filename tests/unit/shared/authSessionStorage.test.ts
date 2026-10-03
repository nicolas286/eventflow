import { afterEach, describe, expect, it } from "vitest";
import { createClient, type Session } from "@supabase/supabase-js";
import { createAuthStorage } from "../../../src/shared/gateways/supabase/authStorage";
import { getSessionScope } from "../../../src/shared/gateways/supabase/sessionScope";

const key = "sb-fixture-auth-token";
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (name: string) => values.get(name) ?? null,
    setItem: (name: string, value: string) => { values.set(name, value); },
    removeItem: (name: string) => { values.delete(name); },
  };
}
function session(id = "A", revision = 1, aal = "aal1"): Session {
  return {
    access_token: `${btoa('{}')}.${btoa(JSON.stringify({ session_id: `session-${id}`, aal, revision, exp: Math.floor(Date.now() / 1000) + 3600 }))}.fixture`,
    refresh_token: `synthetic-refresh-${id}-${revision}`, token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id, email: `${id}@example.invalid`, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-02T00:00:00Z" },
  };
}
const clients: ReturnType<typeof createClient>[] = [];
afterEach(async () => { for (const client of clients.splice(0)) await client.auth.stopAutoRefresh(); });

function client(adapter: ReturnType<typeof createAuthStorage>, response: () => Session) {
  const storageKey = `fixture-${crypto.randomUUID()}`;
  const instance = createClient("https://fixture.supabase.co", "public-fixture-key", {
    auth: { storageKey, storage: adapter.forClient(storageKey), autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url) => {
      const path = String(url);
      if (path.endsWith("/challenge")) return Response.json({ id: "challenge-fixture", expires_at: 9999999999 });
      if (path.includes("/logout")) return Response.json({});
      if (path.endsWith("/user")) return Response.json(response().user);
      return Response.json(response());
    } },
  });
  clients.push(instance);
  return instance;
}

describe("single-client session persistence (SDK with synthetic Auth transport)", () => {
  it.each([false, true])("remember=%s survives tab reload and refresh with the selected storage", async (remember) => {
    const local = storage(); const tab = storage();
    const adapter = createAuthStorage(local, tab, key);
    const sdk = client(adapter, () => session("A", 2));
    await sdk.auth.getSession();
    adapter.selectPersistence(remember);
    await sdk.auth.signOut({ scope: "local" });
    expect((await sdk.auth.signInWithPassword({ email: "A@example.invalid", password: "synthetic" })).error).toBeNull();
    expect(local.getItem(key) !== null).toBe(remember);
    const restored = client(createAuthStorage(local, tab, key), () => session("A", 3));
    expect((await restored.auth.getSession()).data.session?.user.id).toBe("A");
    expect((await restored.auth.refreshSession()).error).toBeNull();
    expect((await restored.auth.getSession()).data.session?.refresh_token).toBe("synthetic-refresh-A-3");
    expect(local.getItem(key) !== null).toBe(remember);
    const newTab = client(createAuthStorage(local, storage(), key), () => session());
    expect((await newTab.auth.getSession()).data.session?.user.id ?? null).toBe(remember ? "A" : null);
  });

  it("forgets legacy persistence before a non-persistent B login, and rejects late A refresh writes", async () => {
    const local = storage(); const tab = storage();
    local.setItem(key, JSON.stringify(session("A")));
    local.setItem(`${key}-user`, "old-user");
    local.setItem(`${key}-code-verifier`, "old-verifier");
    const adapter = createAuthStorage(local, tab, key);
    const sdk = client(adapter, () => session("B"));
    expect((await sdk.auth.getSession()).data.session?.user.id).toBe("A");
    adapter.selectPersistence(false);
    await sdk.auth.signOut({ scope: "local" });
    await sdk.auth.signInWithPassword({ email: "B@example.invalid", password: "synthetic" });
    expect(local.values.size).toBe(0);
    expect(() => adapter.forClient("runtime").setItem("runtime", JSON.stringify(session("A", 4)))).toThrow("AUTH_SESSION_REPLACED");
    expect((await sdk.auth.getSession()).data.session?.user.id).toBe("B");
    expect(createAuthStorage(local, storage(), key).forClient("new").getItem("new")).toBeNull();
  });

  it("keeps two tabs' identities independent and prevents old persistent refreshes overwriting B", async () => {
    const local = storage(); const tabA = storage(); const tabB = storage();
    const a = createAuthStorage(local, tabA, key);
    a.selectPersistence(true);
    const sdkA = client(a, () => session("A", 2));
    await sdkA.auth.signInWithPassword({ email: "A@example.invalid", password: "synthetic" });
    const b = createAuthStorage(local, tabB, key);
    b.selectPersistence(true);
    const sdkB = client(b, () => session("B"));
    await sdkB.auth.signInWithPassword({ email: "B@example.invalid", password: "synthetic" });
    await sdkA.auth.refreshSession();
    expect((await sdkA.auth.getSession()).data.session?.user.id).toBe("A");
    expect((await sdkB.auth.getSession()).data.session?.user.id).toBe("B");
    expect(local.getItem(key)).toBe(tabB.getItem(key));
    expect(tabA.getItem(`${key}-remember`)).toBe("false");
  });

  it("shares refreshed tokens between remembered tabs only for the same session", async () => {
    const local = storage(); const tabA = storage(); const tabB = storage();
    const a = createAuthStorage(local, tabA, key);
    a.selectPersistence(true);
    const sdkA = client(a, () => session("A", 2));
    await sdkA.auth.signInWithPassword({ email: "A@example.invalid", password: "synthetic" });
    const b = createAuthStorage(local, tabB, key);
    const sdkB = client(b, () => session("A", 3));
    await sdkB.auth.getSession();
    await sdkB.auth.refreshSession();
    expect((await sdkA.auth.getSession()).data.session?.refresh_token).toBe("synthetic-refresh-A-3");
    expect(tabA.getItem(`${key}-remember`)).toBe("true");
  });

  it("retains session-only storage through MFA verification and cleans logout", async () => {
    const local = storage(); const tab = storage();
    local.setItem("theme", "dark");
    const adapter = createAuthStorage(local, tab, key);
    const sdk = client(adapter, () => session("A", 2, "aal2"));
    await sdk.auth.signInWithPassword({ email: "A@example.invalid", password: "synthetic" });
    const result = await sdk.auth.mfa.challengeAndVerify({ factorId: "factor-fixture", code: "123456" });
    expect(result.error).toBeNull();
    expect((await sdk.auth.getSession()).data.session?.user.id).toBe("A");
    expect(local.getItem(key)).toBeNull();
    await sdk.auth.signOut({ scope: "local" });
    adapter.clear();
    expect(() => adapter.forClient("runtime").setItem("runtime", JSON.stringify(session("A", 4)))).toThrow("AUTH_SESSION_CLOSED");
    expect(tab.values.size).toBe(0);
    expect([...local.values]).toEqual([["theme", "dark"]]);
  });

  it("keeps a cache scope through token renewal/MFA, but changes it for identity, session and logout", () => {
    expect(getSessionScope(session("A", 1))).toBe(getSessionScope(session("A", 2, "aal2")));
    expect(getSessionScope(session("A"))).not.toBe(getSessionScope(session("B")));
    const anotherSession = { ...session("A"), access_token: session("other-login").access_token };
    expect(getSessionScope(session("A"))).not.toBe(getSessionScope(anotherSession));
    expect(getSessionScope(null)).toBeNull();
  });
});
