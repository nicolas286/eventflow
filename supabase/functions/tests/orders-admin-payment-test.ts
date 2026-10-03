import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { handleOrdersRequest } from "../orders/index.ts";

const orderId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";

// HTTP fixtures follow the JSONB contract of the versioned SQL function.
function payment(paid = 1000, total = 10000) {
  return {
    ok: true,
    order_id: orderId,
    paid_cents: paid,
    total_cents: total,
    discount_cents: 0,
    effective_total_cents: total,
    status: paid === total ? "paid" : "partially_paid",
    idempotent: false,
  };
}

async function fixture(
  options: {
    due?: unknown;
    result?: unknown;
    sqlError?: boolean;
    total?: number;
  },
  run: (
    request: (payload?: object) => Promise<Response>,
    calls: { name: string; body: unknown }[],
  ) => Promise<void>,
) {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://orders-fixture.supabase.co",
    RATE_LIMIT_SALT: "fixture-a8-salt",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  };
  const saved = Object.keys(values).map((key) => [key, Deno.env.get(key)]);
  const previousFetch = globalThis.fetch;
  const calls: { name: string; body: unknown }[] = [];
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  globalThis.fetch = (input, init) => {
    const url = String(input);
    const name = new URL(url).pathname.split("/").at(-1) ?? "";
    if (name === "consume_rate_limit") return Promise.resolve(Response.json([{ allowed: true, request_count: 1, retry_after_seconds: 0 }]));
    const body: unknown = typeof init?.body === "string"
      ? JSON.parse(init.body)
      : null;
    calls.push({ name, body });
    if (name === "apply_order_payment") {
      return Promise.resolve(
        options.sqlError
          ? Response.json({ message: "CURRENCY_MISMATCH", code: "P0001" }, {
            status: 400,
          })
          : Response.json("result" in options ? options.result : payment()),
      );
    }
    const data = url.includes("/auth/v1/user")
      ? { id: orderId, email: "fixture@example.test" }
      : name === "platform_public_config"
      ? { registrationsOpen: true }
      : name === "organization_members"
      ? { role: "admin" }
      : name === "organizations"
      ? { status: "active" }
      : name === "events"
      ? { id: eventId, org_id: orderId }
      : name === "event_products"
      ? [{ id: productId, event_id: eventId }]
      : name === "create_order_intent"
      ? {
        order_id: orderId,
        total_cents: options.total ?? 10000,
        amount_due_now_cents: "due" in options ? options.due : 10000,
        currency: "eur",
        payment_required: options.total !== 0,
        status: options.total === 0 ? "paid" : "awaiting_payment",
        booking_token: "fixture-booking",
        expires_at: "2026-10-02T12:00:00Z",
      }
      : null;
    return Promise.resolve(Response.json(data));
  };
  try {
    await run(
      (payload = {}) =>
        handleOrdersRequest(
          new Request("https://edge.test/orders/admin", {
            method: "POST",
            headers: {
              authorization: "Bearer fixture-user",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              eventId,
              items: [{ eventProductId: productId, quantity: 1 }],
              attendees: [{ eventProductId: productId }],
              buyerEmail: "fixture@example.test",
              markPaid: true,
              payMode: "custom",
              customAmountCents: 1000,
              ...payload,
            }),
          }),
        ),
      calls,
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of saved) {
      if (key !== undefined) {
        value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
      }
    }
  }
}

for (
  const scenario of [
    {
      name: "custom 10 EUR of 100 EUR",
      due: 10000,
      paid: 1000,
      mode: "custom",
      status: "partially_paid",
      remainingDue: 9000,
    },
    {
      name: "full payment",
      due: 2000,
      paid: 10000,
      mode: "full",
      status: "paid",
      remainingDue: 0,
    },
    {
      name: "deposit paid",
      due: 2000,
      paid: 2000,
      mode: "deposit",
      status: "partially_paid",
      remainingDue: 0,
    },
    {
      name: "custom below deposit",
      due: 2000,
      paid: 1000,
      mode: "custom",
      status: "partially_paid",
      remainingDue: 1000,
    },
  ]
) {
  Deno.test(`admin response: ${scenario.name}`, () =>
    fixture(
      { due: scenario.due, result: payment(scenario.paid) },
      async (request, calls) => {
        const response = await request({ payMode: scenario.mode });
        assertEquals(response.status, 200);
        const data = await response.json();
        assertEquals(data.status, scenario.status);
        assertEquals(data.dueNowCents, scenario.remainingDue);
        assertEquals(data.totalCents, 10000);
        assertEquals(data.currency, "EUR");
        assertEquals(data.amountAppliedCents, scenario.paid);
        const rpcBody = calls.find((call) =>
          call.name === "apply_order_payment"
        )?.body;
        assert(
          typeof rpcBody === "object" && rpcBody !== null &&
            "p_provider_payment_id" in rpcBody,
        );
        assert(
          typeof rpcBody.p_provider_payment_id === "string" &&
            rpcBody.p_provider_payment_id.startsWith("offline:"),
        );
        assertEquals<unknown>(
          rpcBody,
          {
            p_order_id: orderId,
            p_provider: "offline",
            p_amount_cents: scenario.paid,
            p_currency: "EUR",
            p_provider_payment_id: rpcBody.p_provider_payment_id,
            p_raw: null,
            p_note: `by=${orderId}`,
          },
        );
      },
    ));
}

for (
  const result of [
    null,
    {},
    { ...payment(), ok: false },
    { ...payment(), status: "paid" },
    { ...payment(), order_id: eventId },
    { ...payment(), total_cents: 11000, effective_total_cents: 11000 },
    { ...payment(), paid_cents: -1 },
    { ...payment(), effective_total_cents: 9999 },
  ]
) {
  Deno.test(`admin rejects invalid payment result ${JSON.stringify(result)}`, () =>
    fixture({ result }, async (request) => {
      const response = await request();
      assertEquals(response.status, 500);
      assertEquals(await response.json(), {
        error: "APPLY_ORDER_PAYMENT_INVALID_RESULT",
      });
    }));
}

Deno.test("admin propagates SQL failure without success", () =>
  fixture({ sqlError: true }, async (request) => {
    const response = await request();
    assertEquals(response.status, 400);
    assertEquals(await response.json(), {
      error: "APPLY_ORDER_PAYMENT_FAILED",
      details: { message: "CURRENCY_MISMATCH" },
    });
  }));

Deno.test("admin does not invent missing due amount", () =>
  fixture({ due: null }, async (request, calls) => {
    assertEquals((await request()).status, 500);
    assertEquals(
      calls.some((call) => call.name === "apply_order_payment"),
      false,
    );
  }));

Deno.test("admin honors the SQL replay result without claiming a new payment", () =>
  fixture(
    { result: { ...payment(2000), idempotent: true }, due: 2000 },
    async (request) => {
      const response = await request();
      assertEquals(response.status, 200);
      const data = await response.json();
      assertEquals(data.status, "partially_paid");
      assertEquals(data.dueNowCents, 0);
      assertEquals(data.amountAppliedCents, 0);
      assertEquals(data.payment.idempotent, true);
    },
  ));

Deno.test("admin repetition still creates separate intents and offline references", () =>
  fixture({}, async (request, calls) => {
    assertEquals((await request({ idempotencyKey: "same-key" })).status, 200);
    assertEquals((await request({ idempotencyKey: "same-key" })).status, 200);
    assertEquals(
      calls.filter((call) => call.name === "create_order_intent").length,
      2,
    );
    const bodies = calls.filter((call) => call.name === "apply_order_payment")
      .map((call) => call.body);
    assertNotEquals(bodies[0], bodies[1]);
  }));

Deno.test("admin without manual payment preserves booking response", () =>
  fixture({ due: 2000 }, async (request, calls) => {
    const response = await request({ markPaid: false });
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ok: true,
      orderId,
      currency: "EUR",
      totalCents: 10000,
      status: "awaiting_payment",
      dueNowCents: 2000,
      bookingToken: "fixture-booking",
      expiresAt: "2026-10-02T12:00:00Z",
      amountAppliedCents: null,
      payment: null,
    });
    assertEquals(
      calls.some((call) => call.name === "apply_order_payment"),
      false,
    );
  }));

Deno.test("admin free order skips manual payment", () =>
  fixture({ total: 0, due: 0 }, async (request, calls) => {
    const response = await request({ payMode: "full" });
    assertEquals(response.status, 200);
    const data = await response.json();
    assertEquals(data.status, "paid");
    assertEquals(data.amountAppliedCents, 0);
    assertEquals(data.dueNowCents, 0);
    assertEquals(
      calls.some((call) => call.name === "apply_order_payment"),
      false,
    );
  }));
