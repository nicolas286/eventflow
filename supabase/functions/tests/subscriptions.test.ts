import { startSubscription } from "../subscriptions/start.ts";
import { cancelSubscription } from "../subscriptions/cancel.ts";
import { startSubscriptionPayloadSchema } from "../../../shared/schemas/subscriptions.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

const orgId = "11111111-1111-4111-8111-111111111111";

Deno.test("subscription contract normalizes promo and keeps the 100-character limit", () => {
  const parsed = startSubscriptionPayloadSchema.parse({
    orgId,
    plan: " STARTER ",
    promoCode: " early ",
  });
  assert(parsed.plan === "starter" && parsed.promoCode === "EARLY");
  assert(
    !startSubscriptionPayloadSchema.safeParse({ orgId, plan: "free" }).success,
  );
  assert(
    !startSubscriptionPayloadSchema.safeParse({
      orgId,
      plan: "pro",
      promoCode: "x".repeat(101),
    }).success,
  );
});

Deno.test("subscription operations reject missing sessions before any provider call", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Unexpected external call");
  };
  try {
    const started = await startSubscription(
      new Request("https://local.test/subscriptions", { method: "POST" }),
    );
    const canceled = await cancelSubscription(
      new Request(`https://local.test/subscriptions/${orgId}`, {
        method: "DELETE",
      }),
      orgId,
    );
    assert(started.status === 401 && canceled.status === 401);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("cancellation rejects invalid path identifiers before any provider call", async () => {
  const response = await cancelSubscription(
    new Request("https://local.test/subscriptions/invalid", {
      method: "DELETE",
      headers: { authorization: "Bearer fixture" },
    }),
    "invalid",
  );
  assert(response.status === 400);
});

Deno.test("another organization cannot start or cancel a subscription", async () => {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    SUPABASE_ANON_KEY: "fixture-anon",
    MOLLIE_API_KEY: "test_fixture",
    APP_ENV: "staging",
    APP_ALLOWED_ORIGINS: "https://staging.example.test",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    assert(
      !init?.method || init.method === "GET",
      "No mutation allowed before authorization",
    );
    if (url.includes("/auth/v1/user")) {
      return Promise.resolve(
        Response.json({
          id: "22222222-2222-4222-8222-222222222222",
          email: "qa@example.test",
        }),
      );
    }
    if (url.includes("/rest/v1/organization_members")) {
      return Promise.resolve(Response.json([]));
    }
    throw new Error(`Unexpected call: ${url}`);
  };
  try {
    const headers = {
      authorization: "Bearer fixture",
      origin: "https://staging.example.test",
      "content-type": "application/json",
    };
    const start = await startSubscription(
      new Request("https://local.test/subscriptions", {
        method: "POST",
        headers,
        body: JSON.stringify({ orgId, plan: "pro" }),
      }),
    );
    const cancel = await cancelSubscription(
      new Request(`https://local.test/subscriptions/${orgId}`, {
        method: "DELETE",
        headers,
      }),
      orgId,
    );
    assert(
      start.status === 403 && cancel.status === 403,
      `${start.status}/${cancel.status}`,
    );
    assert(requests.length === 4);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(previous)) {
      value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    }
  }
});

async function authorizedFixture(
  run: () => Promise<void>,
  respond: (
    url: string,
    method: string,
    body: BodyInit | null | undefined,
  ) => Response,
) {
  const env = {
    EARLY_ADOPTER_ACTIVE: "false",
    EARLY_ADOPTER_CODE: "",
    EARLY_ADOPTER_PERCENT: "0",
    EARLY_ADOPTER_ALLOWED_PLANS: "",
    APP_ENV: "staging",
    MOLLIE_API_KEY: "test_fixture",
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    APP_ALLOWED_ORIGINS: "https://staging.example.test",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes("/auth/v1/user")) {
      return Promise.resolve(
        Response.json({
          id: "22222222-2222-4222-8222-222222222222",
          email: "qa@example.test",
        }),
      );
    }
    if (url.includes("/rest/v1/organization_members")) {
      return Promise.resolve(Response.json([{ role: "owner" }]));
    }
    return Promise.resolve(respond(url, init?.method ?? "GET", init?.body));
  };
  try {
    await run();
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(previous)) {
      value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    }
  }
}

const headers = {
  authorization: "Bearer fixture",
  origin: "https://staging.example.test",
  "content-type": "application/json",
};

Deno.test("first subscription checkout retains its price and points Mollie at the domain webhook", async () => {
  let createdPayment = false;
  await authorizedFixture(async () => {
    const res = await startSubscription(
      new Request("https://local.test/subscriptions", {
        method: "POST",
        headers,
        body: JSON.stringify({ orgId, plan: "starter" }),
      }),
    );
    const body = await res.json();
    assert(res.status === 200 && body.action === "checkout" && createdPayment);
    assert(
      body.billingPriceValue === "15.99" &&
        body.checkoutUrl === "https://checkout.example.test/fixture",
    );
  }, (url, method, rawBody) => {
    if (url.includes("/rest/v1/subscriptions")) return Response.json(null);
    if (url.includes("/rpc/create_subscription_intent")) {
      return Response.json({ mollie_customer_id: "cst_fixture" });
    }
    if (url.includes("/rest/v1/organizations")) {
      return Response.json({ id: orgId, name: "Fixture" });
    }
    if (url.endsWith("/customers/cst_fixture/mandates")) {
      return Response.json({ _embedded: { mandates: [] } });
    }
    if (url.endsWith("/customers/cst_fixture/payments")) {
      assert(method === "POST" && typeof rawBody === "string");
      const payload = JSON.parse(rawBody);
      assert(
        payload.webhookUrl ===
          "https://fixture.supabase.co/functions/v1/subscriptions/webhooks/first-payment",
      );
      assert(
        payload.redirectUrl.startsWith(
          "https://staging.example.test/admin/abonnement",
        ),
      );
      assert(
        payload.sequenceType === "first" && payload.amount.value === "15.99",
      );
      createdPayment = true;
      return Response.json({
        id: "tr_fixture",
        _links: { checkout: { href: "https://checkout.example.test/fixture" } },
      });
    }
    throw new Error(`Unexpected call ${url}`);
  });
});

Deno.test("starting an already active plan reuses the existing subscription without a payment", async () => {
  await authorizedFixture(async () => {
    const res = await startSubscription(
      new Request("https://local.test/subscriptions", {
        method: "POST",
        headers,
        body: JSON.stringify({ orgId, plan: "pro" }),
      }),
    );
    const body = await res.json();
    assert(
      res.status === 200 && body.reused &&
        body.mollieSubscriptionId === "sub_fixture",
    );
  }, (url, method) => {
    assert(method === "GET" && url.includes("/rest/v1/subscriptions"));
    return Response.json({
      status: "active",
      plan: "pro",
      mollie_customer_id: "cst_fixture",
      mollie_subscription_id: "sub_fixture",
      current_period_end: null,
    });
  });
});

Deno.test("cancellation refuses an invalid Mollie mapping before changing the plan", async () => {
  await authorizedFixture(async () => {
    const res = await cancelSubscription(
      new Request(`https://local.test/subscriptions/${orgId}`, {
        method: "DELETE",
        headers,
      }),
      orgId,
    );
    assert(
      res.status === 502 &&
        (await res.json()).error === "MOLLIE_SUB_404_WRONG_MAPPING",
    );
  }, (url, method) => {
    assert(
      method === "GET",
      "No mutation should follow a wrong provider mapping",
    );
    if (url.includes("/rest/v1/subscriptions")) {
      return Response.json({
        status: "active",
        plan: "pro",
        mollie_customer_id: "cst_fixture",
        mollie_subscription_id: "sub_fixture",
      });
    }
    assert(
      url ===
        "https://api.mollie.com/v2/customers/cst_fixture/subscriptions/sub_fixture",
    );
    return Response.json({ error: "not found" }, { status: 404 });
  });
});

Deno.test("owner cancellation verifies Mollie before deleting the subscription and restoring free", async () => {
  const mutations: string[] = [];
  await authorizedFixture(async () => {
    const res = await cancelSubscription(
      new Request(`https://local.test/subscriptions/${orgId}`, {
        method: "DELETE",
        headers,
      }),
      orgId,
    );
    const body = await res.json();
    assert(
      res.status === 200 && body.action === "canceled" &&
        body.mollieAction === "canceled",
    );
    assert(
      mutations.length === 3 &&
        mutations[0].startsWith("DELETE https://api.mollie.com/"),
    );
    assert(
      mutations[1].startsWith("PATCH") &&
        mutations[2].includes("subscriptions"),
    );
  }, (url, method) => {
    if (method !== "GET") {
      mutations.push(`${method} ${url}`);
      return new Response(null, { status: 204 });
    }
    if (url.includes("/rest/v1/subscriptions")) {
      return Response.json({
        status: "active",
        plan: "pro",
        mollie_customer_id: "cst_fixture",
        mollie_subscription_id: "sub_fixture",
      });
    }
    assert(
      url ===
        "https://api.mollie.com/v2/customers/cst_fixture/subscriptions/sub_fixture",
    );
    return Response.json({ id: "sub_fixture", status: "active" });
  });
});
