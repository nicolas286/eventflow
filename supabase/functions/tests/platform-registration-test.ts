import { assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ResponseError } from "../_shared/errors.ts";
import { assertPlatformRegistrationsOpen } from "../orders/platform-registration.ts";
import { handleOrdersRequest } from "../orders/index.ts";

function client(data: unknown, error: unknown = null) {
  return { rpc: () => Promise.resolve({ data, error }) } as unknown as SupabaseClient;
}

Deno.test("global registration gate allows explicit open state", async () => {
  await assertPlatformRegistrationsOpen(client({ registrationsOpen: true, registrationPublicMessage: "Bienvenue" }));
});

Deno.test("global registration gate fails closed with the public message", async () => {
  const error = await assertRejects(() => assertPlatformRegistrationsOpen(client({
    registrationsOpen: false,
    registrationPublicMessage: "Refonte en cours",
  })), ResponseError);
  assertEquals(error.status, 503);
  assertEquals(error.code, "REGISTRATIONS_CLOSED");
  assertEquals(error.details, { message: "Refonte en cours" });
});

Deno.test("global registration gate fails closed if configuration is unavailable", async () => {
  const error = await assertRejects(
    () => assertPlatformRegistrationsOpen(client(null, { message: "db unavailable" })),
    ResponseError,
  );
  assertEquals(error.status, 500);
  assertEquals(error.code, "PLATFORM_REGISTRATION_CONFIG_UNAVAILABLE");
});

Deno.test("closed registrations reject direct public and organizer order requests", async () => {
  const env = { SUPABASE_URL: "https://registration-fixture.supabase.co", SUPABASE_ANON_KEY: "fixture-anon", SUPABASE_SERVICE_ROLE_KEY: "fixture-service", RATE_LIMIT_SALT: "fixture-salt" };
  const previousEnv = new Map(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("consume_rate_limit")) return Promise.resolve(Response.json([{ allowed: true, request_count: 1, retry_after_seconds: 0 }]));
    if (url.includes("platform_public_config")) return Promise.resolve(Response.json({ registrationsOpen: false, registrationPublicMessage: "Maintenance" }));
    if (url.includes("/auth/v1/user")) return Promise.resolve(Response.json({ id: "11111111-1111-4111-8111-111111111111", email: "owner@example.test" }));
    return Promise.resolve(Response.json(null));
  };
  try {
    const publicResponse = await handleOrdersRequest(new Request("https://edge.test/orders", { method: "POST", body: "{}" }));
    assertEquals(publicResponse.status, 503);
    assertEquals(await publicResponse.json(), { error: "REGISTRATIONS_CLOSED" });
    const adminResponse = await handleOrdersRequest(new Request("https://edge.test/orders/admin", { method: "POST", headers: { authorization: "Bearer fixture" }, body: "{}" }));
    assertEquals(adminResponse.status, 503);
    assertEquals(await adminResponse.json(), { error: "REGISTRATIONS_CLOSED", details: { message: "Maintenance" } });
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
});
