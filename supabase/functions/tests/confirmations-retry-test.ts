import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import {
  retryOrderConfirmations,
  sendConfirmationEmailForOrderSafe,
} from "../orders/public/emails.ts";
import { completeTicketPayment } from "../_shared/payments/stripe-checkout-lifecycle.ts";
import { resolveRuntimeConfig } from "../orders/public/config.ts";
import { handleSendReminderMailRequest } from "../workers/index.ts";
import { handleStripeWebhookConnect } from "../stripe-webhook-connect/index.ts";

const orderId = "a6500000-0000-4000-8000-000000000001";
const token = "a6500000-0000-4000-8000-000000000002";
const url = "https://confirmation-fixture.supabase.co";
const envelope = {
  from: "Fixture <fixture@example.test>",
  to: "buyer@example.test",
  subject: "Confirmation",
  html: "<p>Archived contract</p>",
  attachments: [{
    filename: "tickets.pdf",
    content: "JVBERi0=",
    contentType: "application/pdf",
  }],
  tags: { kind: "order_confirmation", orderId },
};

async function fixture(
  run: (ctx: ReturnType<typeof context>) => Promise<void>,
  resend = false,
) {
  const values: Record<string, string> = {
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    APP_ENV: "staging",
    APP_BASE_URL: "https://fixture.example.test",
    MAIL_MODE: resend ? "resend" : "capture",
    RESEND_API_KEY: "fixture-key",
    MAIL_ALLOWED_RECIPIENTS: "buyer@example.test",
    EDGE_SERVICE_TOKEN: "fixture-worker",
    STRIPE_SECRET_KEY: "",
    STRIPE_CONNECT_WEBHOOK_SECRET: "whsec_fixture",
  };
  const previous = new Map(
    [...Object.keys(values), "FUNCTIONS_URL"].map((
      key,
    ) => [key, Deno.env.get(key)]),
  );
  const fetcher = globalThis.fetch;
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  Deno.env.delete("FUNCTIONS_URL");
  try {
    await run(context());
  } finally {
    globalThis.fetch = fetcher;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

function context() {
  const events: string[] = [];
  const logger = {
    requestId: "fixture",
    info(event: string) {
      events.push(event);
    },
    warn(event: string) {
      events.push(event);
    },
    error(event: string) {
      events.push(event);
    },
  };
  const admin = createClient(url, "fixture-service", {
    global: { fetch: (input, init) => globalThis.fetch(input, init) },
  });

  const send = () =>
    sendConfirmationEmailForOrderSafe({ admin, logger, orderId });
  return { events, logger, admin, send };
}

function claim(payload: unknown = envelope) {
  return {
    claimed: true,
    claimToken: token,
    payload,
    provider: payload ? "capture" : null,
  };
}
function dispatch(payload: unknown = envelope, provider = "capture") {
  return {
    payload,
    provider,
    dispatchBefore: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

Deno.test("nominal confirmation marks provider acceptance and works without FUNCTIONS_URL", () =>
  fixture(async (ctx) => {
    const paths: string[] = [];
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path.endsWith("/claim_order_confirmation_delivery")) {
        return Response.json(claim());
      }
      if (path.endsWith("/prepare_order_confirmation_dispatch")) {
        assertEquals((await request.json()).p_claim_token, token);
        return Response.json(dispatch());
      }
      if (path.includes("/storage/v1/object/mail-previews/")) {
        const body = await request.json();
        assertEquals(
          body.payload.idempotencyKey,
          `order-confirmation:${orderId}`,
        );
        assertEquals(body.payload.attachments, envelope.attachments);
        return Response.json({});
      }
      if (path.endsWith("/complete_order_confirmation_delivery")) {
        const body = await request.json();
        assertEquals(body.p_success, true);
        assertEquals(body.p_claim_token, token);
        assert(typeof body.p_provider_message_id === "string");
        return Response.json(true);
      }
      throw new Error(`Unexpected request ${path}`);
    };
    assertEquals(await ctx.send(), "sent");
    assertEquals(paths.length, 4);
    assertEquals(ctx.events, ["confirmation_email_sent"]);
    const config = resolveRuntimeConfig(
      new Request("https://fixture.example.test/orders/register"),
    );
    assertEquals(config.appBaseUrl, "https://fixture.example.test");
  }));

Deno.test("claim RPC errors never authorize send or release an unknown claim", () =>
  fixture(async (ctx) => {
    const paths: string[] = [];
    globalThis.fetch = (input) => {
      paths.push(new URL(String(input)).pathname);
      return Promise.resolve(
        Response.json({ message: "database unavailable" }, { status: 503 }),
      );
    };
    assertEquals(await ctx.send(), "failed");
    assertEquals(paths, ["/rest/v1/rpc/claim_order_confirmation_delivery"]);
    assertEquals(ctx.events.includes("confirmation_email_sent"), false);
  }));

for (
  const reason of [
    "not_eligible",
    "sent",
    "in_progress",
    "backoff",
    "review_required",
    "legacy_unknown",
  ]
) {
  Deno.test(`confirmation ${reason} cannot send`, () =>
    fixture(async (ctx) => {
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        return Promise.resolve(Response.json({ claimed: false, reason }));
      };
      assertEquals(await ctx.send(), "skipped");
      assertEquals(calls, 1);
      assertEquals(ctx.events.includes("confirmation_email_sent"), false);
      if (["review_required", "legacy_unknown"].includes(reason)) {
        assertEquals(ctx.events, ["confirmation_email_review_required"]);
      }
    }));
}

for (const failPersistence of [false, true]) {
  Deno.test(`provider failure remains recoverable; failure persistence error=${failPersistence}`, () =>
    fixture(async (ctx) => {
      let releases = 0;
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path.endsWith("/claim_order_confirmation_delivery")) {
          return Response.json(claim());
        }
        if (path.endsWith("/prepare_order_confirmation_dispatch")) {
          return Response.json(dispatch());
        }
        if (path.includes("/mail-previews/")) {
          return Response.json({}, { status: 503 });
        }
        if (path.endsWith("/complete_order_confirmation_delivery")) {
          const body = await request.json();
          assertEquals(body.p_success, false);
          assertEquals(body.p_claim_token, token);
          assertEquals(body.p_error_code, "CONFIRMATION_DELIVERY_FAILED");
          releases++;
          return failPersistence
            ? Response.json({ message: "down" }, { status: 500 })
            : Response.json(true);
        }
        throw new Error(`Unexpected request ${path}`);
      };
      assertEquals(await ctx.send(), "failed");
      assertEquals(releases, 1);
      assertEquals(ctx.events.includes("confirmation_email_sent"), false);
      assertEquals(
        ctx.events.includes("confirmation_email_failure_save_failed"),
        failPersistence,
      );
    }));
}

for (
  const invalid of [null, {
    ...dispatch(),
    dispatchBefore: new Date(Date.now() - 1).toISOString(),
  }]
) {
  Deno.test(`expired or stale dispatch authorization prevents provider calls (${invalid === null ? "stale" : "window"})`, () =>
    fixture(async (ctx) => {
      let captures = 0;
      globalThis.fetch = (input) => {
        const path = new URL(String(input)).pathname;
        if (path.endsWith("/claim_order_confirmation_delivery")) {
          return Promise.resolve(Response.json(claim()));
        }
        if (path.endsWith("/prepare_order_confirmation_dispatch")) {
          return Promise.resolve(Response.json(invalid));
        }
        if (path.endsWith("/complete_order_confirmation_delivery")) {
          return Promise.resolve(Response.json(false));
        }
        captures++;
        return Promise.resolve(Response.json({}));
      };
      assertEquals(await ctx.send(), "failed");
      assertEquals(captures, 0);
      assertEquals(
        ctx.events.includes("confirmation_email_failure_save_failed"),
        true,
      );
    }));
}

for (const markResponse of [false, "rpc_error"]) {
  Deno.test(`Resend acceptance then DB ${markResponse} replays identical key and body once`, () =>
    fixture(async (ctx) => {
      let markAttempts = 0;
      let sends = 0;
      let accepted = 0;
      let storedBody: string | undefined;
      let storedKey: string | null = null;
      globalThis.fetch = async (input, init) => {
        const request = new Request(input, init);
        const path = new URL(request.url).pathname;
        if (path.endsWith("/claim_order_confirmation_delivery")) {
          return Response.json({ ...claim(), provider: "resend" });
        }
        if (path.endsWith("/prepare_order_confirmation_dispatch")) {
          return Response.json(dispatch(envelope, "resend"));
        }
        if (request.url === "https://api.resend.com/emails") {
          const key = request.headers.get("Idempotency-Key");
          const body = await request.text();
          assertEquals(key, `order-confirmation:${orderId}`);
          if (storedBody === undefined) {
            storedBody = body;
            storedKey = key;
            accepted++;
          } else {
            assertEquals(body, storedBody);
            assertEquals(key, storedKey);
          }
          sends++;
          return Response.json({ id: "provider-fixture-id" });
        }
        if (path.endsWith("/complete_order_confirmation_delivery")) {
          const body = await request.json();
          if (!body.p_success) {
            assertEquals(
              body.p_error_code,
              "CONFIRMATION_ACCEPTED_MARK_FAILED",
            );
            return Response.json(true);
          }
          markAttempts++;
          if (markAttempts === 1) {
            return markResponse === false
              ? Response.json(false)
              : Response.json({ message: "down" }, { status: 500 });
          }
          return Response.json(true);
        }
        throw new Error(`Unexpected request ${path}`);
      };
      assertEquals(await ctx.send(), "failed");
      assertEquals(ctx.events.includes("confirmation_email_sent"), false);
      assertEquals(await ctx.send(), "sent");
      assertEquals({ sends, accepted, markAttempts }, {
        sends: 2,
        accepted: 1,
        markAttempts: 2,
      });
    }, true));
}

Deno.test("first durable confirmation preserves contract evidence and generates ticket PDF before dispatch", () =>
  fixture(async (ctx) => {
    let saved: unknown;
    let captured: unknown;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/claim_order_confirmation_delivery")) {
        return Response.json(claim(null));
      }
      if (path.endsWith("/prepare_order_confirmation_dispatch")) {
        saved = (await request.json()).p_payload;
        return Response.json(dispatch(saved));
      }
      if (path.endsWith("/complete_order_confirmation_delivery")) {
        return Response.json(true);
      }
      if (path.includes("/mail-previews/")) {
        captured = (await request.json()).payload;
        return Response.json({});
      }
      if (path.endsWith("/orders")) {
        return Response.json({
          id: orderId,
          event_id: token,
          currency: "EUR",
          total_cents: 500,
          paid_cents: 500,
          buyer_email: "buyer@example.test",
          booking_token: "synthetic",
          platform_terms_version: "historic",
          platform_terms_snapshot: "Archived platform terms",
          organizer_sales_terms_version: "seller-historic",
          organizer_sales_terms_snapshot: "Archived seller terms",
          organizer_identity_snapshot: {
            legal_name: "Archived seller",
            email: "seller@example.test",
          },
          terms_accepted_at: "2026-10-01T12:00:00Z",
        });
      }
      if (path.endsWith("/events")) {
        return Response.json({ title: "Fixture event" });
      }
      if (path.endsWith("/tickets")) {
        return Response.json([{
          id: token,
          product_id: token,
          order_item_id: token,
          ticket_index: 1,
          qr_token: "synthetic-qr",
          admits_count: 1,
        }]);
      }
      if (path.endsWith("/event_products")) {
        return Response.json([{ id: token, creates_attendees: false }]);
      }
      if (path.endsWith("/order_items")) {
        return Response.json([{
          id: token,
          product_name_snapshot: "Fixture ticket",
          unit_price_cents_snapshot: 500,
          quantity: 1,
        }]);
      }
      if (
        path.endsWith("/promo_code_redemptions") ||
        path.endsWith("/order_attendees")
      ) return Response.json([]);
      throw new Error(`Unexpected request ${path}`);
    };
    assertEquals(await ctx.send(), "sent");
    assert(
      typeof saved === "object" && saved !== null && "html" in saved &&
        "attachments" in saved,
    );
    assertStringIncludes(String(saved.html), "Archived platform terms");
    assertStringIncludes(String(saved.html), "Archived seller terms");
    assertStringIncludes(String(saved.html), "Archived seller");
    assertStringIncludes(String(saved.html), "historic");
    assert(Array.isArray(saved.attachments) && saved.attachments.length === 1);
    assert(atob(saved.attachments[0].content).startsWith("%PDF-"));
    assertEquals(captured, {
      ...saved,
      idempotencyKey: `order-confirmation:${orderId}`,
    });
  }));

Deno.test("repeated payment completion and delivery cron never replay financial effects", () =>
  fixture(async (ctx) => {
    let paid = false;
    let issued = false;
    let delivered = false;
    let payments = 0;
    let tickets = 0;
    let captures = 0;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/apply_stripe_checkout_payment")) {
        if (!paid) payments++;
        paid = true;
        return Response.json({ action: "paid", idempotent: payments > 0 });
      }
      if (path.endsWith("/issue_order_tickets")) {
        if (!issued) tickets++;
        issued = true;
        return Response.json([]);
      }
      if (path.endsWith("/claim_order_confirmation_delivery")) {
        return Response.json(
          delivered ? { claimed: false, reason: "sent" } : claim(),
        );
      }
      if (path.endsWith("/prepare_order_confirmation_dispatch")) {
        return Response.json(dispatch());
      }
      if (path.includes("/mail-previews/")) {
        captures++;
        return Response.json({});
      }
      if (path.endsWith("/complete_order_confirmation_delivery")) {
        delivered = (await request.json()).p_success;
        return Response.json(true);
      }
      if (path.endsWith("/list_pending_order_confirmations")) {
        assertEquals(await request.json(), { p_limit: 25 });
        return Response.json(delivered ? [] : [{ order_id: orderId }]);
      }
      throw new Error(`Unexpected request ${path}`);
    };
    const input = {
      admin: ctx.admin,
      logger: ctx.logger,
      connectedAccountId: "acct_fixture",
      object: {
        id: "cs_fixture",
        payment_intent: "pi_fixture",
        amount_total: 500,
        currency: "eur",
        metadata: { eventflow_order_id: orderId },
      },
    };
    await completeTicketPayment(input);
    await completeTicketPayment(input);
    assertEquals({ payments, tickets, captures }, {
      payments: 1,
      tickets: 1,
      captures: 1,
    });
    assertEquals(await retryOrderConfirmations(ctx.admin, ctx.logger), {
      sent: 0,
      failed: 0,
      skipped: 0,
    });
  }));

Deno.test("confirmation retry keeps existing worker authentication and cron integration", () =>
  fixture(async () => {
    let claims = 0;
    let captures = 0;
    globalThis.fetch = (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/list_pending_order_confirmations")) {
        claims++;
        return Promise.resolve(Response.json([{ order_id: orderId }]));
      }
      if (path.endsWith("/claim_order_confirmation_delivery")) {
        return Promise.resolve(Response.json(claim()));
      }
      if (path.endsWith("/prepare_order_confirmation_dispatch")) {
        return Promise.resolve(Response.json(dispatch()));
      }
      if (path.includes("/mail-previews/")) {
        captures++;
        return Promise.resolve(Response.json({}));
      }
      if (path.endsWith("/complete_order_confirmation_delivery")) {
        return Promise.resolve(Response.json(true));
      }
      return Promise.resolve(Response.json([])); // existing reminder/invoice read-only loads
    };
    const makeRequest = (secret: string) =>
      new Request("https://edge.test/workers/reminders", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      });
    assertEquals(
      (await handleSendReminderMailRequest(makeRequest("wrong"))).status,
      401,
    );
    assertEquals(claims, 0);
    const response = await handleSendReminderMailRequest(
      makeRequest("fixture-worker"),
    );
    assertEquals(response.status, 200);
    assertEquals((await response.json()).confirmations, {
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    assertEquals({ claims, captures }, { claims: 1, captures: 1 });
  }));

Deno.test("a successful payment webhook with failed email is recovered only by delivery cron", () =>
  fixture(async (ctx) => {
    let processed = false;
    let paymentApplications = 0;
    let ticketIssuances = 0;
    let captures = 0;
    let delivered = false;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.endsWith("/claim_payment_webhook_event")) {
        return Response.json({
          should_process: !processed,
          already_processed: processed,
        });
      }
      if (path.endsWith("/apply_stripe_checkout_payment")) {
        paymentApplications++;
        return Response.json({ action: "paid", idempotent: false });
      }
      if (path.endsWith("/issue_order_tickets")) {
        ticketIssuances++;
        return Response.json([]);
      }
      if (path.endsWith("/complete_payment_webhook_event")) {
        processed = (await request.json()).p_success;
        return Response.json(null);
      }
      if (path.endsWith("/claim_order_confirmation_delivery")) {
        return Response.json(claim());
      }
      if (path.endsWith("/prepare_order_confirmation_dispatch")) {
        return Response.json(dispatch());
      }
      if (path.includes("/mail-previews/")) {
        captures++;
        return Response.json({}, { status: captures === 1 ? 503 : 200 });
      }
      if (path.endsWith("/complete_order_confirmation_delivery")) {
        delivered = (await request.json()).p_success;
        return Response.json(true);
      }
      if (path.endsWith("/list_pending_order_confirmations")) {
        return Response.json([{ order_id: orderId }]);
      }
      throw new Error(`Unexpected webhook request ${path}`);
    };
    const signedRequest = async () => {
      const body = JSON.stringify({
        id: "evt_confirmation_fixture",
        type: "checkout.session.completed",
        account: "acct_fixture",
        livemode: false,
        data: {
          object: {
            id: "cs_fixture",
            payment_intent: "pi_fixture",
            amount_total: 500,
            currency: "eur",
            payment_status: "paid",
            metadata: { eventflow_order_id: orderId },
          },
        },
      });
      const timestamp = Math.floor(Date.now() / 1000);
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode("whsec_fixture"),
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
      return new Request("https://edge.fixture/stripe-webhook-connect", {
        method: "POST",
        body,
        headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      });
    };
    assertEquals(
      (await handleStripeWebhookConnect(await signedRequest())).status,
      200,
    );
    assertEquals({
      processed,
      delivered,
      paymentApplications,
      ticketIssuances,
      captures,
    }, {
      processed: true,
      delivered: false,
      paymentApplications: 1,
      ticketIssuances: 1,
      captures: 1,
    });
    assertEquals(
      (await handleStripeWebhookConnect(await signedRequest())).status,
      200,
    );
    assertEquals({ paymentApplications, ticketIssuances, captures }, {
      paymentApplications: 1,
      ticketIssuances: 1,
      captures: 1,
    });
    assertEquals(await retryOrderConfirmations(ctx.admin, ctx.logger), {
      sent: 1,
      failed: 0,
      skipped: 0,
    });
    assertEquals({
      delivered,
      paymentApplications,
      ticketIssuances,
      captures,
    }, {
      delivered: true,
      paymentApplications: 1,
      ticketIssuances: 1,
      captures: 2,
    });
  }));
