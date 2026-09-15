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
