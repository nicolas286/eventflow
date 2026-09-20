import { createClient } from "@supabase/supabase-js";
import { migrateSubscriptionWebhooks } from "../workers/migrate-subscription-webhooks.ts";

const base = "https://cpcmcxerrsnnjncrhldr.supabase.co";
const orgId = "11111111-1111-4111-8111-111111111111";
const oldRecurring = `${base}/functions/v1/mollie-subscription-webhook`;
const oldFirst = `${base}/functions/v1/payment-first`;
type Call = { url: string; method: string; body: unknown };
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function subscription() {
  return {
    id: "sub_fixture",
    customerId: "cst_fixture",
    mode: "test",
    status: "active",
    webhookUrl: oldRecurring,
    metadata: { org_id: orgId, kind: "platform_subscription" },
  };
}
function payment() {
  return {
    id: "tr_fixture",
    customerId: "cst_fixture",
    mode: "test",
    status: "open",
    webhookUrl: oldFirst,
    metadata: { org_id: orgId, kind: "subscription_first" },
  };
}

async function fixture(
  run: (
    invoke: (payload?: unknown, token?: string) => Promise<Response>,
    calls: Call[],
  ) => Promise<void>,
  overrides: Record<string, string> = {},
  response?: (call: Call, calls: Call[]) => Response | undefined,
) {
  const env = {
    APP_ENV: "staging",
    SUPABASE_URL: base,
    MOLLIE_API_KEY: "test_fixture",
    EDGE_SERVICE_TOKEN: "fixture-worker",
    ...overrides,
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (input, init) => {
    const call = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    };
    calls.push(call);
    const custom = response?.(call, calls);
    if (custom) return Promise.resolve(custom);
    if (call.url.includes("/rest/v1/subscriptions")) {
      return Promise.resolve(
        Response.json([{
          org_id: orgId,
          mollie_customer_id: "cst_fixture",
          mollie_subscription_id: "sub_fixture",
        }]),
      );
    }
    if (call.url.endsWith("/customers/cst_fixture/subscriptions/sub_fixture")) {
      return Promise.resolve(
        Response.json({
          ...subscription(),
          ...(call.method === "PATCH"
            ? {
              webhookUrl:
                `${base}/functions/v1/subscriptions/webhooks/recurring-payment`,
            }
            : {}),
        }),
      );
    }
    if (call.url.includes("/customers/cst_fixture/payments?")) {
      return Promise.resolve(Response.json({
        _embedded: {
          payments: [
            payment(),
            {
              ...payment(),
              id: "tr_other",
              webhookUrl: "https://other.example.test/payment-first",
            },
            { ...payment(), id: "tr_paid", status: "paid" },
            {
              ...payment(),
              id: "tr_wrongorg",
              metadata: {
                org_id: "22222222-2222-4222-8222-222222222222",
                kind: "subscription_first",
              },
            },
          ],
        },
        _links: { next: null },
      }));
    }
    if (call.url.endsWith("/payments/tr_fixture")) {
      return Promise.resolve(
        Response.json({
          ...payment(),
          ...(call.method === "PATCH"
            ? {
              webhookUrl:
                `${base}/functions/v1/subscriptions/webhooks/first-payment`,
            }
            : {}),
        }),
      );
    }
    throw new Error(`Unexpected request ${call.url}`);
  };
  const admin = createClient(base, "fixture-service", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const invoke = (payload: unknown = {}, token = "fixture-worker") =>
    migrateSubscriptionWebhooks(
      new Request(
        `${base}/functions/v1/workers/migrate-subscription-webhooks`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      ),
      admin,
    );
  try {
    await run(invoke, calls);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(previous)) {
      value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    }
  }
}

Deno.test("migration worker refuses an unauthorized caller before inventory", async () => {
  await fixture(async (invoke, calls) => {
    const result = await invoke({}, "wrong-token");
    assert(result.status === 401 && calls.length === 0);
  });
});

Deno.test("migration worker refuses production or a live key before inventory", async () => {
  const cases: Record<string, string>[] = [{ APP_ENV: "production" }, {
    SUPABASE_URL: "https://dixirvllhfkvqoahhfqh.supabase.co",
  }, { MOLLIE_API_KEY: "live_fixture" }];
  for (const overrides of cases) {
    await fixture(async (invoke, calls) => {
      const result = await invoke({ apply: true });
      assert(result.status === 403 && calls.length === 0);
    }, overrides);
  }
});

Deno.test("migration is read-only by default and selects only this staging's active callbacks", async () => {
  await fixture(async (invoke, calls) => {
    const result = await invoke();
    const body = await result.json();
    assert(
      result.status === 200 && body.apply === false &&
        body.applied.length === 0,
    );
    assert(
      body.candidates.length === 2 &&
        calls.every((call) => call.method === "GET"),
    );
  });
});

Deno.test("apply patches only webhookUrl of the matching subscription and pending payment", async () => {
  await fixture(async (invoke, calls) => {
    const result = await invoke({ apply: true });
    const body = await result.json();
    assert(result.status === 200 && body.applied.length === 2);
    const patches = calls.filter((call) => call.method === "PATCH");
    assert(patches.length === 2);
    assert(
      JSON.stringify(patches[0].body) ===
        JSON.stringify({
          webhookUrl:
            `${base}/functions/v1/subscriptions/webhooks/recurring-payment`,
        }),
    );
    assert(
      JSON.stringify(patches[1].body) ===
        JSON.stringify({
          webhookUrl:
            `${base}/functions/v1/subscriptions/webhooks/first-payment`,
        }),
    );
    for (const patch of patches) {
      assert(
        calls.slice(0, calls.indexOf(patch)).some((call) =>
          call.method === "GET" && call.url === patch.url
        ),
      );
    }
  });
});

Deno.test("inventory pagination never forwards credentials outside the customer payment endpoint", async () => {
  await fixture(
    async (invoke, calls) => {
      const result = await invoke({ apply: true });
      assert(
        result.status === 409 && calls.every((call) => call.method === "GET"),
      );
      assert(!calls.some((call) => call.url.includes("attacker")));
    },
    {},
    (call) =>
      call.url.includes("/payments?")
        ? Response.json({
          _embedded: { payments: [] },
          _links: { next: { href: "https://attacker.example.test/steal" } },
        })
        : undefined,
  );
});

Deno.test("apply skips a callback changed since inventory", async () => {
  await fixture(
    async (invoke, calls) => {
      const result = await invoke({ apply: true });
      const body = await result.json();
      assert(
        result.status === 200 && body.skippedChanged.includes("sub_fixture"),
      );
      assert(calls.filter((call) => call.method === "PATCH").length === 1);
    },
    {},
    (call, calls) =>
      call.url.endsWith("/subscriptions/sub_fixture") &&
        calls.filter((item) => item.url === call.url).length > 1
        ? Response.json({
          ...subscription(),
          webhookUrl: "https://other.example.test/callback",
        })
        : undefined,
  );
});
