import { startSubscription } from "../subscriptions/start.ts";
import { cancelSubscription } from "../subscriptions/cancel.ts";
import { startSubscriptionPayloadSchema } from "../../../shared/schemas/subscriptions.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

const orgId = "11111111-1111-4111-8111-111111111111";

Deno.test(
  "subscription contract normalizes promo and keeps the 100-character limit",
  () => {
    const parsed = startSubscriptionPayloadSchema.parse({
      orgId,
      plan: " STARTER ",
      promoCode: " early ",
    });
    assert(parsed.plan === "starter" && parsed.promoCode === "EARLY");
    assert(
      !startSubscriptionPayloadSchema.safeParse({ orgId, plan: "free" })
        .success,
    );
    assert(
      !startSubscriptionPayloadSchema.safeParse({
        orgId,
        plan: "pro",
        promoCode: "x".repeat(101),
      }).success,
    );
  },
);

Deno.test(
  "subscription operations reject missing sessions before any provider call",
  async () => {
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
  },
);

Deno.test(
  "cancellation rejects invalid path identifiers before any provider call",
  async () => {
    const response = await cancelSubscription(
      new Request("https://local.test/subscriptions/invalid", {
        method: "DELETE",
        headers: { authorization: "Bearer fixture" },
      }),
      "invalid",
    );
    assert(response.status === 400);
  },
);

Deno.test(
  "another organization cannot start or cancel a subscription",
  async () => {
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
  },
);

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
    RATE_LIMIT_SALT: "fixture-a8-salt",
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
    if (url.includes("/rpc/consume_rate_limit")) {
      return Promise.resolve(Response.json([{ allowed: true, request_count: 1, retry_after_seconds: 0 }]));
    }
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

Deno.test(
  "subscription start creates an internal invoice without a provider checkout",
  async () => {
    let invoiceRpcCalled = false;
    await authorizedFixture(
      async () => {
        const res = await startSubscription(
          new Request("https://local.test/subscriptions", {
            method: "POST",
            headers,
            body: JSON.stringify({ orgId, plan: "starter" }),
          }),
        );
        const body = await res.json();
        assert(
          res.status === 200 && body.action === "invoice" && invoiceRpcCalled,
        );
        assert(
          body.billingPriceValue === "15.99" &&
            body.provider === "manual" &&
            body.invoiceNumber === "2026-000001",
        );
      },
      (url, method, rawBody) => {
        assert(!url.includes("api.mollie.com"), "Mollie must remain read-only");
        if (url.includes("/rpc/create_manual_subscription_invoice")) {
          assert(method === "POST" && typeof rawBody === "string");
          invoiceRpcCalled = true;
          return Response.json({
            ok: true,
            org_id: orgId,
            plan: "starter",
            provider: "manual",
            status: "active",
            invoice_id: "22222222-2222-4222-8222-222222222222",
            invoice_number: "2026-000001",
            due_at: "2026-10-12T00:00:00.000Z",
            current_period_end: "2026-10-28T00:00:00.000Z",
            reused: true,
          });
        }
        throw new Error(`Unexpected call ${url}`);
      },
    );
  },
);

Deno.test(
  "an idempotent subscription request reuses the current internal invoice",
  async () => {
    await authorizedFixture(
      async () => {
        const res = await startSubscription(
          new Request("https://local.test/subscriptions", {
            method: "POST",
            headers,
            body: JSON.stringify({ orgId, plan: "pro" }),
          }),
        );
        const body = await res.json();
        assert(
          res.status === 200 &&
            body.reused &&
            body.invoiceId === "33333333-3333-4333-8333-333333333333",
        );
      },
      (url, method) => {
        assert(!url.includes("api.mollie.com"), "Mollie must remain read-only");
        assert(
          method === "POST" &&
            url.includes("/rpc/create_manual_subscription_invoice"),
        );
        return Response.json({
          ok: true,
          org_id: orgId,
          plan: "pro",
          provider: "manual",
          status: "active",
          invoice_id: "33333333-3333-4333-8333-333333333333",
          invoice_number: "2026-000002",
          due_at: "2026-10-12T00:00:00.000Z",
          current_period_end: "2026-10-28T00:00:00.000Z",
          reused: true,
        });
      },
    );
  },
);

Deno.test(
  "owner cancellation is local and preserves provider history",
  async () => {
    const mutations: string[] = [];
    await authorizedFixture(
      async () => {
        const res = await cancelSubscription(
          new Request(`https://local.test/subscriptions/${orgId}`, {
            method: "DELETE",
            headers,
          }),
          orgId,
        );
        const body = await res.json();
        assert(
          res.status === 200 &&
            body.action === "canceled" &&
            body.mollieAction === "skipped",
        );
        assert(
          mutations.length === 1 &&
            mutations[0].startsWith("POST") &&
            mutations[0].includes("/rpc/cancel_internal_subscription"),
        );
      },
      (url, method) => {
        assert(!url.includes("api.mollie.com"), "Mollie must remain read-only");
        if (method !== "GET") {
          mutations.push(`${method} ${url}`);
          return Response.json({ ok: true, org_id: orgId });
        }
        if (url.includes("/rest/v1/subscriptions")) {
          return Response.json({
            status: "active",
            plan: "pro",
          });
        }
        throw new Error(`Unexpected call ${url}`);
      },
    );
  },
);
