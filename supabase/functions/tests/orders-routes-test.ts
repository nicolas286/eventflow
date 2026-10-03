import { assertEquals, assertStringIncludes } from "@std/assert";
import { handleOrdersRequest } from "../orders/index.ts";
import { parseRegisterPayload } from "../orders/public/validation.ts";
import { ResponseError } from "../_shared/errors.ts";
import { assertRejects } from "@std/assert";

const orderId = "11111111-1111-4111-8111-111111111111";

async function withRuntime(run: () => Promise<void>) {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://orders-fixture.supabase.co",
    RATE_LIMIT_SALT: "fixture-a8-salt",
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

Deno.test("orders routes reject anonymous bank-transfer confirmation", () => withRuntime(async () => {
  const response = await handleOrdersRequest(new Request(
    `https://edge.test/orders/admin/${orderId}/mark-paid`,
    { method: "POST" },
  ));
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "NOT_AUTHENTICATED" });
}));

Deno.test("bank-transfer confirmation rejects a user outside the organization", () => withRuntime(async () => {
  const previous = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (input) => {
    const url = String(input);
    urls.push(url);
    const data = url.includes("/auth/v1/user")
      ? { id: orderId, email: "fixture@example.com" }
      : url.includes("/orders?")
      ? {
        id: orderId,
        org_id: "22222222-2222-4222-8222-222222222222",
        status: "awaiting_payment",
        total_cents: 2000,
        paid_cents: 0,
        currency: "EUR",
      }
      : null;
    return Promise.resolve(Response.json(data));
  };
  try {
    const response = await handleOrdersRequest(new Request(
      `https://edge.test/orders/admin/${orderId}/mark-paid`,
      { method: "POST", headers: { authorization: "Bearer fixture-user" } },
    ));
    assertEquals(response.status, 403);
    assertEquals(await response.json(), { error: "FORBIDDEN" });
    assertEquals(urls.some((url) => url.includes("apply_order_payment")), false);
  } finally { globalThis.fetch = previous; }
}));

Deno.test("an organization admin can confirm a bank transfer idempotently", () => withRuntime(async () => {
  const previous = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("/rpc/consume_rate_limit")) return Promise.resolve(Response.json([{ allowed: true, request_count: 1, retry_after_seconds: 0 }]));
    urls.push(url);
    const data = url.includes("/auth/v1/user")
      ? { id: orderId, email: "fixture@example.com" }
      : url.includes("/orders?")
      ? {
        id: orderId,
        org_id: "22222222-2222-4222-8222-222222222222",
        status: "awaiting_payment",
        total_cents: 2000,
        paid_cents: 0,
        currency: "EUR",
      }
      : url.includes("/organization_members?")
      ? { role: "admin" }
      : url.includes("/payments?")
      ? {
        amount_cents: 2000,
        currency: "EUR",
        status: "open",
        raw: { method: "bank_transfer" },
      }
      : url.includes("/rpc/apply_order_payment")
      ? { status: "paid", paid_cents: 2000, total_cents: 2000, idempotent: false }
      : url.includes("/rpc/claim_order_confirmation_email")
      ? { ok: false }
      : null;
    return Promise.resolve(Response.json(data));
  };
  try {
    const response = await handleOrdersRequest(new Request(
      `https://edge.test/orders/admin/${orderId}/mark-paid`,
      { method: "POST", headers: { authorization: "Bearer fixture-user" } },
    ));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ok: true,
      orderId,
      status: "paid",
      paidCents: 2000,
      totalCents: 2000,
      idempotent: false,
    });
    assertEquals(urls.some((url) => url.includes("issue_order_tickets")), true);
  } finally { globalThis.fetch = previous; }
}));

Deno.test("public order read counts missing token before refusing access to order storage", () => withRuntime(async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (input) => {
    assertStringIncludes(String(input), "/rpc/consume_rate_limit");
    return Promise.resolve(Response.json([{ allowed: true, request_count: 1, retry_after_seconds: 0 }]));
  };
  try {
    const response = await handleOrdersRequest(new Request(`https://edge.test/orders/${orderId}`));
    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: "MISSING_TOKEN" });
  } finally { globalThis.fetch = previous; }
}));

Deno.test("public order lookup matches both order id and booking token", () => withRuntime(async () => {
  const previous = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (input) => {
    if (String(input).includes("/rpc/consume_rate_limit")) return Promise.resolve(Response.json([{ allowed: true, request_count: 1, retry_after_seconds: 0 }]));
    urls.push(String(input));
    return Promise.resolve(new Response("null", { status: 200, headers: { "content-type": "application/json" } }));
  };
  try {
    const response = await handleOrdersRequest(new Request(`https://edge.test/orders/${orderId}?token=wrong-token`));
    assertEquals(response.status, 404);
    assertEquals(urls.length, 1);
    assertStringIncludes(urls[0], `id=eq.${orderId}`);
    assertStringIncludes(urls[0], "booking_token=eq.wrong-token");
    assertEquals(urls.some((url) => url.includes("/payments?")), false);
    assertEquals(urls.some((url) => url.includes("get_bank_transfer_instructions")), false);
  } finally { globalThis.fetch = previous; }
}));

Deno.test("public bank-transfer instructions require the matching booking token", () => withRuntime(async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("/rpc/consume_rate_limit")) return Promise.resolve(Response.json([{ allowed: true, request_count: 1, retry_after_seconds: 0 }]));
    const data = url.includes("/orders?")
      ? { id: orderId, status: "awaiting_payment", total_cents: 2599, currency: "EUR" }
      : url.includes("/payments?")
      ? {
        provider: "offline",
        provider_payment_id: `bank_transfer:${orderId}`,
        status: "open",
        amount_cents: 2599,
        currency: "EUR",
        raw: { method: "bank_transfer" },
      }
      : url.includes("/rpc/get_bank_transfer_instructions")
      ? {
        internalReference: "EF-11111111111141118111111111111111",
        communication: "EVENTFLOW | Concert | participant@example.com | EF-11111111111141118111111111111111",
        beneficiary: "Eventflow ASBL",
        iban: "BE51732081025262",
        amountCents: 2599,
        currency: "EUR",
        paymentDueAt: null,
      }
      : null;
    return Promise.resolve(Response.json(data));
  };
  try {
    const response = await handleOrdersRequest(new Request(
      `https://edge.test/orders/${orderId}?token=matching-token`,
    ));
    assertEquals(response.status, 200);
    const body = await response.json();
    assertEquals(body.status, "awaiting_payment");
    assertEquals(body.bankTransfer.iban, "BE51732081025262");
    assertEquals(body.bankTransfer.amountCents, 2599);
  } finally { globalThis.fetch = previous; }
}));

Deno.test("public order read preserves the database cancelled spelling", () => withRuntime(async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (input) => {
    const url = String(input);
    if (url.includes("/rpc/consume_rate_limit")) return Promise.resolve(Response.json([{ allowed: true, request_count: 1, retry_after_seconds: 0 }]));
    const data = url.includes("/orders?")
      ? { id: orderId, status: "cancelled", total_cents: 2000, currency: "EUR", event_id: "22222222-2222-4222-8222-222222222222", org_id: "33333333-3333-4333-8333-333333333333", buyer_email: "participant@example.com" }
      : url.includes("/events?")
      ? { slug: "concert-2026" }
      : url.includes("/organizations?")
      ? { slug: "emberfox" }
      : url.includes("/order_items?")
      ? [{ product_name_snapshot: "Billet standard", unit_price_cents_snapshot: 1000, quantity: 2 }]
      : { provider: "offline", provider_payment_id: `bank_transfer:${orderId}`, status: "open" };
    return Promise.resolve(Response.json(data));
  };
  try {
    const response = await handleOrdersRequest(new Request(`https://edge.test/orders/${orderId}?token=fixture-booking-token`));
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      id: orderId, status: "cancelled", totalCents: 2000, currency: "EUR", paymentStatus: "open", paymentMethod: "bank_transfer", bankTransfer: null,
      orgSlug: "emberfox", eventSlug: "concert-2026",
      buyerEmail: "participant@example.com",
      items: [{ name: "Billet standard", quantity: 2, unitPriceCents: 1000, totalCents: 2000, currency: "EUR" }],
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
      : url.includes("/rpc/platform_public_config")
      ? { registrationsOpen: true, registrationPublicMessage: "Bienvenue" }
      : url.includes("/events?")
      ? { id: orderId, org_id: "22222222-2222-4222-8222-222222222222" }
      : null;
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
