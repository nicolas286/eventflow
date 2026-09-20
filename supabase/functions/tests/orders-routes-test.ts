import { assertEquals, assertStringIncludes } from "@std/assert";
import { handleOrdersRequest } from "../orders/index.ts";
import { parseRegisterPayload } from "../orders/public/validation.ts";
import { ResponseError } from "../_shared/errors.ts";
import { assertRejects } from "@std/assert";

const orderId = "11111111-1111-4111-8111-111111111111";

async function withRuntime(run: () => Promise<void>) {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://orders-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  };
  const previous = new Map(Object.keys(values).map((key) => [key, Deno.env.get(key)]));
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  try { await run(); } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
}

Deno.test("orders routes reject anonymous administrative creation", () => withRuntime(async () => {
  const response = await handleOrdersRequest(new Request("https://edge.test/orders/admin", { method: "POST" }));
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "NOT_AUTHENTICATED" });
}));

Deno.test("public order read requires booking token before accessing storage", () => withRuntime(async () => {
  const response = await handleOrdersRequest(new Request(`https://edge.test/orders/${orderId}`));
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "MISSING_TOKEN" });
}));

Deno.test("public order lookup matches both order id and booking token", () => withRuntime(async () => {
  const previous = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (input) => {
    urls.push(String(input));
    return Promise.resolve(new Response("null", { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    const response = await handleOrdersRequest(new Request(`https://edge.test/orders/${orderId}?token=wrong-token`));
    assertEquals(response.status, 404);
    assertEquals(urls.length, 1);
    assertStringIncludes(urls[0], `id=eq.${orderId}`);
    assertStringIncludes(urls[0], "booking_token=eq.wrong-token");
  } finally { globalThis.fetch = previous; }
}));

Deno.test("public order read preserves the database cancelled spelling", () => withRuntime(async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (input) => {
    const data = String(input).includes("/orders?")
      ? { id: orderId, status: "cancelled", total_cents: 2000, currency: "EUR" }
      : { status: "canceled" };
    return Promise.resolve(Response.json(data));
  };
  try {
    const response = await handleOrdersRequest(new Request(`https://edge.test/orders/${orderId}?token=fixture-booking-token`));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      id: orderId, status: "cancelled", totalCents: 2000, currency: "EUR", paymentStatus: "canceled",
    });
  } finally { globalThis.fetch = previous; }
}));

Deno.test("orders rejects unsupported paths and methods without invoking business services", async () => {
  assertEquals((await handleOrdersRequest(new Request("https://edge.test/orders/admin/extra"))).status, 404);
  assertEquals((await handleOrdersRequest(new Request("https://edge.test/orders", { method: "PUT" }))).status, 405);
  assertEquals((await handleOrdersRequest(new Request("https://edge.test/orders/admin", { method: "OPTIONS" }))).status, 204);
});

Deno.test("administrative creation requires membership in the event organization", () => withRuntime(async () => {
  const previous = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (input) => {
    const url = String(input);
    urls.push(url);
    const data = url.includes("/auth/v1/user")
      ? { id: orderId, email: "fixture@example.com" }
      : url.includes("/events?")
      ? { id: orderId, org_id: "22222222-2222-4222-8222-222222222222" }
      : false;
    return Promise.resolve(new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } }));
  };
  try {
    const response = await handleOrdersRequest(new Request("https://edge.test/orders/admin", {
      method: "POST", headers: { authorization: "Bearer fixture-user", "content-type": "application/json" },
      body: JSON.stringify({ eventId: orderId, buyer: { email: "fixture@example.com" },
        items: [{ eventProductId: orderId, quantity: 1 }], attendees: [{ eventProductId: orderId }] }),
    }));
    assertEquals(response.status, 403);
    assertEquals(await response.json(), { error: "FORBIDDEN" });
    assertEquals(urls.some((url) => url.includes("create_order_intent")), false);
  } finally { globalThis.fetch = previous; }
}));

Deno.test("order boundary rejects oversized bodies and preserves malformed JSON error", async () => {
  const oversized = await assertRejects(() => parseRegisterPayload(new Request("https://edge.test/orders", {
    method: "POST", body: "x".repeat(2 * 1024 * 1024 + 1),
  })), ResponseError);
  assertEquals(oversized.status, 413);
  assertEquals(oversized.code, "PAYLOAD_TOO_LARGE");
  const malformed = await assertRejects(() => parseRegisterPayload(new Request("https://edge.test/orders", {
    method: "POST", body: "{",
  })), ResponseError);
  assertEquals(malformed.code, "INVALID_JSON");
});
