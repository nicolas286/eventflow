import { assertEquals, assertFalse } from "@std/assert";
import { createEdgeHandler } from "../_shared/app/edge-handler/mod.ts";
import { json } from "../_shared/app/http.ts";

const environment = {
  get(name: string): string | undefined {
    const values: Record<string, string> = {
      SUPABASE_URL: "https://project.example.supabase.co",
      SUPABASE_ANON_KEY: "test-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
    };

    return values[name];
  },
};

Deno.test("public edge handlers ignore bearer headers and service-role access", async () => {
  let handlerCalled = false;
  const handler = createEdgeHandler(
    {
      name: "public-test",
      method: "POST",
      auth: "none",
      requestContextOptions: { environment },
    },
    (context) => {
      handlerCalled = true;
      assertEquals(context.user, null);
      assertFalse(Object.hasOwn(context, "serviceClient"));
      return json(context.req, { ok: true });
    },
  );

  const response = await handler(
    new Request("https://edge.test/public", {
      method: "POST",
      headers: { authorization: "Bearer attacker-controlled-value" },
    }),
  );

  assertEquals(handlerCalled, true);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { ok: true });
});

Deno.test("required edge handlers reject malformed bearer headers", async () => {
  const handler = createEdgeHandler(
    {
      name: "required-test",
      method: "POST",
      auth: "required",
      requestContextOptions: { environment },
    },
    (context) => json(context.req, { ok: true }),
  );

  const response = await handler(
    new Request("https://edge.test/private", {
      method: "POST",
      headers: { authorization: "Bearer first second" },
    }),
  );

  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "UNAUTHORIZED" });
});

Deno.test("preflight is handled before runtime configuration", async () => {
  const handler = createEdgeHandler(
    {
      name: "preflight-test",
      method: "POST",
      auth: "required",
    },
    (context) => json(context.req, { ok: true }),
  );

  const response = await handler(
    new Request("https://edge.test/private", { method: "OPTIONS" }),
  );

  assertEquals(response.status, 204);
});

Deno.test("declarative rate limiting runs after authentication and before the handler", async () => {
  let handlerCalled = false;
  const realFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    paths.push(url.pathname);
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(Response.json({
        id: "11111111-1111-4111-8111-111111111111",
        email: "rate-limit@example.test",
      }));
    }
    assertEquals(url.pathname, "/rest/v1/rpc/consume_rate_limit");
    return Promise.resolve(Response.json([{
      allowed: false,
      request_count: 6,
      retry_after_seconds: 120,
    }]));
  };

  try {
    const handler = createEdgeHandler(
      {
        name: "rate-limited-test",
        method: "DELETE",
        auth: "required",
        serviceClient: true,
        requestContextOptions: { environment },
        rateLimit: {
          scope: "test:delete:1h",
          limit: 5,
          windowSeconds: 3_600,
          salt: "test-salt",
          key: "user",
        },
      },
      (context) => {
        handlerCalled = true;
        return json(context.req, { ok: true });
      },
    );

    const response = await handler(
      new Request("https://edge.test/private", {
        method: "DELETE",
        headers: { authorization: "Bearer valid-token" },
      }),
    );

    assertEquals(response.status, 429);
    assertEquals(response.headers.get("retry-after"), "120");
    assertEquals(await response.json(), { error: "TOO_MANY_REQUESTS" });
    assertEquals(paths, ["/auth/v1/user", "/rest/v1/rpc/consume_rate_limit"]);
    assertFalse(handlerCalled);
  } finally {
    globalThis.fetch = realFetch;
  }
});
