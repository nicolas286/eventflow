import { handleFirstPayment } from "../subscriptions/first-payment.ts";
import { handleRecurringPayment } from "../subscriptions/recurring-payment.ts";

function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

async function fixture(
  run: (calls: string[]) => Promise<void>,
  respond: (url: string) => Response,
) {
  const env = {
    APP_ENV: "staging",
    MOLLIE_API_KEY: "test_fixture",
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    FUNCTIONS_URL: "https://fixture.supabase.co/functions/v1",
  };
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (input) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    return Promise.resolve(respond(url));
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries(previous)) {
      value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
    }
  }
}

function request(id: string) {
  return new Request(
    "https://fixture.test/subscriptions/webhooks/first-payment",
    { method: "POST", body: new URLSearchParams({ id }) },
  );
}

Deno.test("first-payment verifies provider status and ignores an unpaid first payment", async () => {
  await fixture(
    async (calls) => {
      const res = await handleFirstPayment(request("tr_fixture"));
      const body = await res.json();
      assert(res.status === 200 && body.reason === "status_open");
      assert(
        calls.length === 1 &&
          calls[0] === "https://api.mollie.com/v2/payments/tr_fixture",
      );
    },
    () =>
      Response.json({
        id: "tr_fixture",
        status: "open",
        sequenceType: "first",
        metadata: { kind: "subscription_first" },
      }),
  );
});

Deno.test("first-payment ignores recurring payments without touching the database", async () => {
  await fixture(
    async (calls) => {
      const res = await handleFirstPayment(request("tr_fixture"));
      assert((await res.json()).reason === "not_first_recurring");
      assert(calls.length === 1);
    },
    () =>
      Response.json({
        id: "tr_fixture",
        status: "paid",
        sequenceType: "recurring",
      }),
  );
});

Deno.test("recurring webhook asks Mollie for the payment and retries a provider failure", async () => {
  await fixture(async (calls) => {
    const res = await handleRecurringPayment(request("tr_fixture"));
    assert(
      res.status === 500 &&
        (await res.json()).reason === "mollie_fetch_payment_failed",
    );
    assert(calls.length === 1);
  }, () => Response.json({ error: "unavailable" }, { status: 503 }));
});

Deno.test("recurring webhook ignores a payment with no subscription mapping", async () => {
  await fixture(async (calls) => {
    const res = await handleRecurringPayment(request("tr_fixture"));
    assert(
      res.status === 200 &&
        (await res.json()).reason === "payment_has_no_subscription_id",
    );
    assert(calls.length === 1);
  }, () => Response.json({ id: "tr_fixture", status: "paid" }));
});

Deno.test("recurring webhook reuses an invoiced payment without a second invoice or side effect", async () => {
  await fixture(async (calls) => {
    const res = await handleRecurringPayment(request("tr_fixture"));
    const body = await res.json();
    assert(
      res.status === 200 && body.reason === "already_invoiced" &&
        body.invoiceId === "invoice_fixture",
    );
    assert(
      !calls.some((url) =>
        url.includes("rpc_create_invoice") || url.includes("/storage/") ||
        url.includes("billit")
      ),
    );
  }, (url) => {
    if (url === "https://api.mollie.com/v2/payments/tr_fixture") {
      return Response.json({
        id: "tr_fixture",
        status: "paid",
        sequenceType: "recurring",
        subscriptionId: "sub_fixture",
        customerId: "cst_fixture",
      });
    }
    if (url.includes("/rest/v1/subscriptions")) {
      return Response.json({
        org_id: "11111111-1111-4111-8111-111111111111",
        mollie_customer_id: "cst_fixture",
      });
    }
    if (
      url ===
        "https://api.mollie.com/v2/customers/cst_fixture/subscriptions/sub_fixture"
    ) {
      return Response.json({
        id: "sub_fixture",
        status: "active",
        nextPaymentDate: "2026-11-01",
      });
    }
    if (url.includes("/rest/v1/rpc/apply_subscription_state")) {
      return Response.json(null);
    }
    if (url.includes("/rest/v1/invoices")) {
      return Response.json({ id: "invoice_fixture" });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});
