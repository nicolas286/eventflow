import { assert, assertEquals } from "@std/assert";
import { handler } from "../accounts/index.ts";

const orgId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";

async function runDeniedRequest(withSession: boolean) {
  const env = {
    SUPABASE_URL: "https://synthetic.supabase.co",
    SUPABASE_ANON_KEY: "synthetic-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    APP_ENV: "staging",
    MOLLIE_API_KEY: "test_synthetic",
  };
  const previous = new Map(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  const realFetch = globalThis.fetch;
  const requests: URL[] = [];
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  globalThis.fetch = (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    requests.push(url);
    assertEquals(
      req.method,
      "GET",
      "A denied account deletion must make no mutation",
    );
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        Response.json({ id: userId, email: "synthetic@example.test" }),
      );
    }
    assertEquals(
      url.pathname,
      "/rest/v1/organization_members",
      "No subscription lookup or Mollie call before authorization",
    );
    assertEquals(url.searchParams.get("user_id"), `eq.${userId}`);
    assertEquals(url.searchParams.get("org_id"), `eq.${orgId}`);
    assertEquals(url.searchParams.get("role"), "in.(owner,admin)");
    return Promise.resolve(Response.json(null));
  };
  try {
    const response = await handler(
      new Request("https://edge.test/accounts/me", {
        method: "DELETE",
        headers: withSession
          ? { authorization: "Bearer synthetic-user-token" }
          : {},
        body: JSON.stringify({ orgId }),
      }),
    );
    return { response, requests };
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("account deletion denies another organization before provider or database mutation", async () => {
  const { response, requests } = await runDeniedRequest(true);
  assertEquals(response.status, 403);
  assertEquals(await response.json(), { error: "FORBIDDEN" });
  assertEquals(requests.length, 2);
});

Deno.test("account deletion requires a session before looking up an organization", async () => {
  const { response, requests } = await runDeniedRequest(false);
  assertEquals(response.status, 401);
  assert(requests.length === 0);
});
