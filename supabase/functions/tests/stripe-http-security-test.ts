import { assertEquals } from "@std/assert";
import { handleStripeConnectStart } from "../stripe-connect-start/index.ts";
import { handleStripeConnectStatus } from "../stripe-connect-status/index.ts";
import { handleStripeWebhookConnect } from "../stripe-webhook-connect/index.ts";
import {
  STRIPE_CONNECT_MAX_BODY_BYTES,
  STRIPE_WEBHOOK_MAX_BODY_BYTES,
} from "../_shared/payments/stripe-connect-http.ts";
import {
  stripeConnectStartResultSchema,
  stripeConnectStatusResultSchema,
} from "../../../shared/schemas/stripe-connect.ts";

const orgId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";
const origin = "https://app.fixture.test";
const webhookSecret = "whsec_synthetic";

async function fixture(run: (calls: Request[]) => Promise<void>, options: {
  member?: boolean;
  allowed?: boolean;
  creatorAllowed?: boolean;
  accountType?: string;
  ready?: boolean;
  existingAccount?: boolean;
} = {}) {
  const values = {
    SUPABASE_URL: "https://synthetic.supabase.co",
    RATE_LIMIT_SALT: "fixture-a8-salt",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    APP_ENV: "staging",
    STRIPE_SECRET_KEY: "sk_test_fixture",
    STRIPE_CONNECT_WEBHOOK_SECRET: webhookSecret,
    APP_ALLOWED_ORIGINS: origin,
  };
  const previous = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  const realFetch = globalThis.fetch;
  const calls: Request[] = [];
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  globalThis.fetch = (input, init) => {
    const req = new Request(input, init);
    calls.push(req);
    const url = new URL(req.url);
    if (url.pathname === "/rest/v1/rpc/consume_rate_limit") return Promise.resolve(Response.json([{ allowed: true, request_count: 1, retry_after_seconds: 0 }]));
    if (url.pathname === "/auth/v1/user") {
      return Promise.resolve(
        Response.json({ id: userId, email: "fixture@example.test" }),
      );
    }
    if (url.pathname === "/rest/v1/organization_members") {
      assertEquals(url.searchParams.get("org_id"), `eq.${orgId}`);
      assertEquals(url.searchParams.get("user_id"), `eq.${userId}`);
      assertEquals(url.searchParams.get("role"), "in.(owner,admin)");
      return Promise.resolve(
        Response.json(options.member === false ? null : { role: "admin" }),
      );
    }
    if (url.pathname === "/rest/v1/user_profile") {
      return Promise.resolve(Response.json({
        stripe_connect_allowed:
          url.searchParams.get("user_id") === `eq.${userId}`
            ? options.allowed !== false
            : options.creatorAllowed !== false,
      }));
    }
    if (url.pathname === "/rest/v1/organizations") {
      return Promise.resolve(
        Response.json({
          id: orgId,
          name: "Fixture",
          created_by: "creator-fixture",
          payments_provider: "stripe",
          stripe_connected_account_id: options.existingAccount === false
            ? null
            : "acct_fixture",
        }),
      );
    }
    if (url.pathname === "/rest/v1/rpc/assert_organization_contract_ready") {
      return Promise.resolve(
        Response.json({ message: "ORGANIZER_PLATFORM_AGREEMENTS_REQUIRED" }, {
          status: 400,
        }),
      );
    }
    if (
      url.hostname === "api.stripe.com" &&
      url.pathname === "/v1/accounts/acct_fixture"
    ) {
      return Promise.resolve(Response.json({
        id: "acct_fixture",
        type: options.accountType ?? "standard",
        details_submitted: options.ready !== false,
        charges_enabled: options.ready !== false,
        payouts_enabled: options.ready !== false,
        requirements: { currently_due: [] },
        secret_fixture: "must-not-leak",
      }));
    }
    if (
      url.hostname === "api.stripe.com" && url.pathname === "/v1/account_links"
    ) {
      return Promise.resolve(
        Response.json({ url: "https://connect.stripe.com/fixture" }),
      );
    }
    if (url.pathname === "/rest/v1/rpc/claim_payment_webhook_event") {
      return Promise.resolve(Response.json({ should_process: true }));
    }
    if (url.pathname === "/rest/v1/rpc/complete_payment_webhook_event") {
      return Promise.resolve(Response.json(null));
    }
    throw new Error(`Unexpected call: ${req.method} ${url.pathname}`);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

function request(
  body: string,
  length?: string,
  stream = false,
  requestOrigin = origin,
) {
  const bytes = new TextEncoder().encode(body);
  // Split UTF-8 across chunks to exercise the streaming decoder.
  const chunks = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 127) {
        controller.enqueue(bytes.slice(i, i + 127));
      }
      controller.close();
    },
  });
  const headers = new Headers({
    authorization: "Bearer fixture-token",
    origin: requestOrigin,
  });
  if (length !== undefined) headers.set("content-length", length);
  return new Request("https://edge.fixture.test", {
    method: "POST",
    headers,
    body: stream ? chunks : body,
  });
}

for (
  const [name, handler] of [["start", handleStripeConnectStart], [
    "status",
    handleStripeConnectStatus,
  ]] as const
) {
  Deno.test(`Stripe Connect ${name}: malformed/invalid payloads stop before business or provider`, () =>
    fixture(async (calls) => {
      for (
        const body of [
          "{",
          "null",
          "[]",
          "{}",
          '{"orgId":42}',
          '{"orgId":"invalid"}',
          '{"orgId":"22222222-2222-7222-8222-222222222222"}',
        ]
      ) {
        calls.length = 0;
        const response = await handler(request(body));
        assertEquals(response.status, 400);
        assertEquals(await response.json(), { error: "INVALID_ORG_ID" });
        assertEquals(calls.map((call) => new URL(call.url).pathname), [
          "/auth/v1/user",
        ]);
      }
    }));

  Deno.test(`Stripe Connect ${name}: byte boundaries and absent/misleading Content-Length`, () =>
    fixture(async (calls) => {
      const payload = JSON.stringify({ orgId });
      for (
        const size of [
          STRIPE_CONNECT_MAX_BODY_BYTES - 1,
          STRIPE_CONNECT_MAX_BODY_BYTES,
          STRIPE_CONNECT_MAX_BODY_BYTES + 1,
        ]
      ) {
        for (const length of [undefined, "1", String(size)]) {
          calls.length = 0;
          const response = await handler(
            request(payload.padEnd(size), length, true),
          );
          assertEquals(
            response.status,
            size > STRIPE_CONNECT_MAX_BODY_BYTES ? 413 : 200,
          );
          if (response.status === 413) {
            assertEquals(await response.json(), { error: "PAYLOAD_TOO_LARGE" });
            assertEquals(calls.map((call) => new URL(call.url).pathname), [
              "/auth/v1/user",
            ]);
          } else {
            const data: unknown = await response.json();
            assertEquals(
              (name === "start"
                ? stripeConnectStartResultSchema
                : stripeConnectStatusResultSchema).safeParse(data).success,
              true,
            );
            assertEquals(
              JSON.stringify(data).includes("secret_fixture"),
              false,
            );
          }
        }
      }
      calls.length = 0;
      assertEquals(
        (await handler(
          request(payload, String(STRIPE_CONNECT_MAX_BODY_BYTES + 1)),
        )).status,
        413,
      );
      assertEquals(calls.length, 1);
    }));

  for (
    const options of [{ member: false }, { allowed: false }, {
      creatorAllowed: false,
    }]
  ) {
    Deno.test(`Stripe Connect ${name}: permission/allowlist ${JSON.stringify(options)} preserved`, () =>
      fixture(async (calls) => {
        assertEquals(
          (await handler(request(JSON.stringify({ orgId })))).status,
          403,
        );
        assertEquals(
          calls.every((call) =>
            call.method === "GET" &&
            new URL(call.url).hostname !== "api.stripe.com"
          ),
          true,
        );
      }, options));
  }
}

Deno.test("Stripe Connect start preserves origin and new-account compliance checks", async () => {
  await fixture(async (calls) => {
    assertEquals(
      (await handleStripeConnectStart(
        request(
          JSON.stringify({ orgId }),
          undefined,
          false,
          "https://denied.fixture.test",
        ),
      )).status,
      403,
    );
    assertEquals(calls.length, 1);
  });
  await fixture(async (calls) => {
    const response = await handleStripeConnectStart(
      request(JSON.stringify({ orgId })),
    );
    assertEquals(response.status, 409);
    assertEquals(await response.json(), {
      error: "ORGANIZER_PLATFORM_AGREEMENTS_REQUIRED",
    });
    assertEquals(
      calls.some((call) => new URL(call.url).hostname === "api.stripe.com"),
      false,
    );
  }, { existingAccount: false });
});

for (
  const [options, status] of [
    [{ ready: false }, "pending"],
    [{}, "connected"],
    [{ accountType: "express" }, "requires_migration"],
  ] as const
) {
  Deno.test(`Stripe Connect status preserves ${status}`, () =>
    fixture(async () => {
      const response = await handleStripeConnectStatus(
        request(JSON.stringify({ orgId })),
      );
      assertEquals(response.status, 200);
      const data = stripeConnectStatusResultSchema.parse(await response.json());
      assertEquals(data.status, status);
      assertEquals(data.complianceVerified, status !== "requires_migration");
    }, options));
}

async function sign(body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const signature = Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `t=${timestamp},v1=${signature}`;
}

const eventBody =
  ' { "id": "evt_fixture", "type": "fixture.ignored", "account": "acct_fixture", "livemode": false, "data": {"object": {"text": "é😊", "escaped": "\\u00e9", "number": 1.00}} }\n';

Deno.test("Stripe webhook rejects an excessive declared Content-Length before reading or effects", () =>
  fixture(async (calls) => {
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        controller.enqueue(new TextEncoder().encode(eventBody));
      },
    }, { highWaterMark: 0 });
    const req = new Request("https://edge.fixture.test", {
      method: "POST",
      body,
      headers: {
        "content-length": String(STRIPE_WEBHOOK_MAX_BODY_BYTES + 1),
        "stripe-signature": await sign(eventBody),
      },
    });
    const response = await handleStripeWebhookConnect(req);
    assertEquals(response.status, 413);
    assertEquals(await response.json(), { error: "PAYLOAD_TOO_LARGE" });
    assertEquals(reads, 0);
    assertEquals(calls.length, 0);
    await req.body?.cancel();
  }));

Deno.test("Stripe webhook: signed raw whitespace/Unicode/JSON representation survives boundaries", () =>
  fixture(async (calls) => {
    for (
      const size of [
        STRIPE_WEBHOOK_MAX_BODY_BYTES - 1,
        STRIPE_WEBHOOK_MAX_BODY_BYTES,
        STRIPE_WEBHOOK_MAX_BODY_BYTES + 1,
      ]
    ) {
      const body = eventBody +
        " ".repeat(size - new TextEncoder().encode(eventBody).length);
      const signature = await sign(body);
      for (const length of [undefined, "1", String(size)]) {
        calls.length = 0;
        const req = request(body, length, true);
        req.headers.set("stripe-signature", signature);
        const response = await handleStripeWebhookConnect(req);
        assertEquals(
          response.status,
          size > STRIPE_WEBHOOK_MAX_BODY_BYTES ? 413 : 200,
        );
        if (response.status === 413) {
          assertEquals(await response.json(), { error: "PAYLOAD_TOO_LARGE" });
          assertEquals(calls.length, 0);
        } else {
          assertEquals(await response.json(), { received: true });
          assertEquals(calls.map((call) => new URL(call.url).pathname), [
            "/rest/v1/rpc/claim_payment_webhook_event",
            "/rest/v1/rpc/complete_payment_webhook_event",
          ]);
        }
      }
    }
  }));

Deno.test("Stripe webhook: missing/invalid signature, changed representation and malformed signed JSON have no effects", () =>
  fixture(async (calls) => {
    for (
      const [body, signature] of [[eventBody, null], [eventBody, "invalid"], [
        eventBody.trim(),
        await sign(eventBody),
      ], ["{", await sign("{")]] as const
    ) {
      const req = request(body);
      if (signature) req.headers.set("stripe-signature", signature);
      const response = await handleStripeWebhookConnect(req);
      assertEquals(response.status, 400);
      assertEquals(await response.json(), { error: "INVALID_SIGNATURE" });
      assertEquals(calls.length, 0);
    }
  }));
