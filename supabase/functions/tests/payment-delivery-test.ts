import { assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import {
  retryBankTransferInstructions,
  sendBankTransferInstructions,
} from "../_shared/services/order-confirmation/index.ts";
import { sendInvoiceToBillit } from "../_shared/services/billit/index.ts";
import { startSubscription } from "../subscriptions/start.ts";

const orderId = "a6100000-0000-4000-8000-000000000001";
const orgId = "a6100000-0000-4000-8000-000000000002";
const invoiceId = "a6100000-0000-4000-8000-000000000003";
const claimToken = "a6100000-0000-4000-8000-000000000004";
const logger = { requestId: "fixture", info() {}, warn() {}, error() {} };
const instructions = {
  orderId,
  amountCents: 2500,
  currency: "EUR",
  beneficiary: "Synthetic beneficiary",
  iban: "BE68539007547034",
  communication: "Synthetic communication",
  internalReference: "EF-FIXTURE",
  paymentDueAt: null,
};

async function fixture(run: () => Promise<void>, production = false) {
  const values: Record<string, string> = {
    // Production identity exercises the guard only; fetch is always replaced by
    // a strict fixture and tests have no network permission.
    SUPABASE_URL: production
      ? "https://dixirvllhfkvqoahhfqh.supabase.co"
      : "https://delivery-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    APP_ENV: production ? "production" : "staging",
    APP_BASE_URL: "https://fixture.example.test",
    MAIL_MODE: "capture",
    EARLY_ADOPTER_ACTIVE: "false",
    EARLY_ADOPTER_CODE: "",
    EARLY_ADOPTER_PERCENT: "0",
    EARLY_ADOPTER_ALLOWED_PLANS: "",
    BILLIT_API_KEY: "fixture-key",
    BILLIT_PARTY_ID: "fixture-party",
    BILLIT_BASE_URL: "https://billit.example.test",
    BILLIT_SELLER_NAME: "Fixture seller",
    BILLIT_SELLER_VAT: "BE0123456789",
    BILLIT_SELLER_COUNTRY: "BE",
    BILLIT_SELLER_ENDPOINT_ID: "0123456789",
    BILLIT_SELLER_STREET: "Test 1",
    BILLIT_SELLER_CITY: "Brussels",
    BILLIT_SELLER_POSTAL_CODE: "1000",
  };
  const previous = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  const oldFetch = globalThis.fetch;
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  try {
    await run();
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("failed bank-transfer email is retried by the existing cron and marked sent only after delivery", () =>
  fixture(async () => {
    let state = "new";
    let attempts = 0;
    const completionFlags: boolean[] = [];
    const keys: string[] = [];
    globalThis.fetch = (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/claim_bank_transfer_email")) {
        if (state === "sent" || state === "sending") {
          return Promise.resolve(
            Response.json({ claimed: false, reason: state }),
          );
        }
        state = "sending";
        return Promise.resolve(Response.json({ claimed: true, claimToken }));
      }
      if (path.endsWith("/complete_bank_transfer_email")) {
        const body = JSON.parse(String(init?.body));
        completionFlags.push(body.p_success);
        assertEquals(body.p_claim_token, claimToken);
        state = body.p_success ? "sent" : "failed";
        return Promise.resolve(Response.json(true));
      }
      if (path.endsWith("/list_pending_bank_transfer_emails")) {
        return Promise.resolve(Response.json([instructions]));
      }
      if (path.endsWith("/orders")) {
        return Promise.resolve(Response.json({
          id: orderId,
          event_id: orgId,
          currency: "EUR",
          total_cents: 2500,
          paid_cents: 0,
          buyer_email: "fixture@example.test",
          booking_token: "synthetic-booking-token",
        }));
      }
      if (path.endsWith("/events")) {
        return Promise.resolve(Response.json({ title: "Fixture event" }));
      }
      if (path.includes("/storage/v1/object/mail-previews/")) {
        assertEquals(state, "sending");
        keys.push(JSON.parse(String(init?.body)).payload.idempotencyKey);
        attempts++;
        return Promise.resolve(
          Response.json({}, { status: attempts === 1 ? 503 : 200 }),
        );
      }
      throw new Error(`Unexpected request: ${path}`);
    };
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      "fixture-service",
    );
    await assertRejects(
      () => sendBankTransferInstructions(admin, logger, instructions),
      Error,
      "MAIL_CAPTURE_FAILED",
    );
    assertEquals(completionFlags, [false]);
    assertEquals(await retryBankTransferInstructions(admin, logger), {
      sent: 1,
      failed: 0,
    });
    assertEquals(completionFlags, [false, true]);
    assertEquals(keys, [
      `bank-transfer-instructions:${orderId}`,
      `bank-transfer-instructions:${orderId}`,
    ]);
    await sendBankTransferInstructions(admin, logger, instructions);
    assertEquals(attempts, 2);
  }));

function startRequest() {
  return new Request("https://fixture.example.test/subscriptions", {
    method: "POST",
    headers: {
      authorization: "Bearer fixture-user",
      "content-type": "application/json",
    },
    body: JSON.stringify({ orgId, plan: "starter" }),
  });
}

function billingFixture(
  options: {
    networkFailure?: boolean;
    missingPdf?: boolean;
    concurrent?: boolean;
  } = {},
) {
  let invoiceCreations = 0;
  let deliveryState = "not_sent";
  let deliveryError: string | null = null;
  let sends = 0;
  let pdfPath: string | null = options.missingPdf
    ? null
    : "fixture/invoice.pdf";
  let pdfLoads = 0;
  let pdfWrites = 0;
  const completions: Array<{ status: string; code: string | null }> = [];
  const invoice = {
    id: invoiceId,
    org_id: orgId,
    number: "2026-000042",
    currency: "EUR",
    subtotal_cents: 1321,
    vat_cents: 278,
    total_cents: 1599,
    vat_rate: 21,
    issued_at: "2026-09-29T12:00:00Z",
    due_at: "2026-10-13T12:00:00Z",
    paid_at: null,
    period_start: "2026-09-29T12:00:00Z",
    period_end: "2026-10-29T12:00:00Z",
    payment_reference: "E-2026-000042",
    billing_snapshot: {
      billing: {
        legalName: "Synthetic buyer",
        countryCode: "BE",
        vatCountryCode: "BE",
        vatNumber: "0123456789",
        addressLine1: "Test 1",
        postalCode: "1000",
        city: "Brussels",
      },
    },
  };
  globalThis.fetch = (input, init) => {
    const url = new URL(String(input));
    const path = url.pathname;
    if (path.endsWith("/auth/v1/user")) {
      return Promise.resolve(
        Response.json({ id: orderId, email: "fixture@example.test" }),
      );
    }
    if (path.endsWith("/organization_members")) {
      return Promise.resolve(Response.json([{ role: "owner" }]));
    }
    if (path.endsWith("/create_manual_subscription_invoice")) {
      invoiceCreations++;
      return Promise.resolve(Response.json({
        ok: true,
        org_id: orgId,
        plan: "starter",
        provider: "manual",
        status: "active",
        invoice_id: invoiceId,
        invoice_number: invoice.number,
        due_at: invoice.due_at,
        current_period_end: invoice.period_end,
        reused: invoiceCreations > 1,
      }));
    }
    if (path.endsWith("/invoices")) {
      if (url.searchParams.get("select") !== "pdf_path" && options.missingPdf) {
        pdfLoads++;
        if (pdfLoads === 1) {
          return Promise.reject(new Error("synthetic pdf load outage"));
        }
      }
      return Promise.resolve(Response.json({ ...invoice, pdf_path: pdfPath }));
    }
    if (path.includes("/storage/v1/object/invoices/")) {
      pdfWrites++;
      return Promise.resolve(Response.json({ Key: "synthetic-pdf" }));
    }
    if (path.endsWith("/rpc_set_invoice_pdf_path")) {
      pdfPath = "fixture/invoice.pdf";
      return Promise.resolve(Response.json(true));
    }
    if (path.endsWith("/claim_invoice_billit_delivery")) {
      const reason = deliveryState === "sent"
        ? "already_sent"
        : deliveryState === "sending"
        ? "in_progress"
        : deliveryError === "BILLIT_DELIVERY_UNKNOWN"
        ? "review_required"
        : null;
      if (reason) {
        return Promise.resolve(Response.json({ claimed: false, reason }));
      }
      deliveryState = "sending";
      return Promise.resolve(Response.json({ claimed: true, claimToken }));
    }
    if (path.endsWith("/invoice_peppol")) {
      return Promise.resolve(
        Response.json({ status: deliveryState, attempt_count: sends }),
      );
    }
    if (path.endsWith("/complete_invoice_billit_delivery")) {
      const body = JSON.parse(String(init?.body));
      deliveryState = body.p_status;
      deliveryError = body.p_error_code;
      completions.push({ status: deliveryState, code: deliveryError });
      return Promise.resolve(Response.json(true));
    }
    if (
      url.origin === "https://billit.example.test" &&
      path === "/v1/peppol/sendxml"
    ) {
      sends++;
      if (options.networkFailure) {
        return Promise.reject(new Error("synthetic transport failure"));
      }
      return Promise.resolve(
        Response.json(
          sends === 1 && !options.concurrent
            ? { error: "synthetic invalid request" }
            : { id: "synthetic-message" },
          { status: sends === 1 && !options.concurrent ? 400 : 200 },
        ),
      );
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  return {
    stats: () => ({ sends, invoiceCreations, pdfWrites, completions }),
    skipBillit: () => {
      deliveryState = "sent";
    },
  };
}

Deno.test("subscription remains successful after Billit failure and reused invoice retries once without duplicate sent delivery", () =>
  fixture(async () => {
    const fixture = billingFixture();
    const first = await startSubscription(startRequest());
    assertEquals(first.status, 200);
    assertEquals((await first.json()).warnings, ["BILLIT_SEND_PENDING"]);
    const second = await startSubscription(startRequest());
    const retried = await second.json();
    assertEquals(second.status, 200);
    assertEquals(retried.reused, true);
    assertEquals(retried.warnings, []);
    await startSubscription(startRequest());
    assertEquals(fixture.stats().sends, 2);
    assertEquals(fixture.stats().completions.map((item) => item.status), [
      "failed",
      "sent",
    ]);
  }, true));

Deno.test("Billit transport failure produces explicit review warning and reused request does not retransmit unknown outcome", () =>
  fixture(async () => {
    const fixture = billingFixture({ networkFailure: true });
    const first = await startSubscription(startRequest());
    assertEquals(first.status, 200);
    assertEquals((await first.json()).warnings, ["BILLIT_REVIEW_REQUIRED"]);
    const retry = await startSubscription(startRequest());
    assertEquals(retry.status, 200);
    assertEquals((await retry.json()).warnings, ["BILLIT_REVIEW_REQUIRED"]);
    assertEquals(fixture.stats().sends, 1);
  }, true));

Deno.test("concurrent Billit delivery is claimed before the external request", () =>
  fixture(async () => {
    const fixture = billingFixture({ concurrent: true });
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      "fixture-service",
    );
    const results = await Promise.all([
      sendInvoiceToBillit(admin, invoiceId),
      sendInvoiceToBillit(admin, invoiceId),
    ]);
    assertEquals(fixture.stats().sends, 1);
    assertEquals(
      results.some((result) => result.data.reason === "in_progress"),
      true,
    );
  }, true));

Deno.test("missing invoice PDF retries after a rejected promise on the reused subscription invoice", () =>
  fixture(async () => {
    const fixture = billingFixture({ missingPdf: true });
    fixture.skipBillit();
    const first = await startSubscription(startRequest());
    assertEquals(first.status, 200);
    assertEquals((await first.json()).warnings, ["INVOICE_PDF_PENDING"]);
    const second = await startSubscription(startRequest());
    assertEquals(second.status, 200);
    assertEquals((await second.json()).warnings, []);
    assertEquals(fixture.stats().pdfWrites, 2); // client and accounting PDFs
    await startSubscription(startRequest());
    assertEquals(fixture.stats().pdfWrites, 2);
  }));

Deno.test("staging still refuses Billit before claiming or transmitting any invoice", () =>
  fixture(async () => {
    globalThis.fetch = () => {
      throw new Error("No network operation expected");
    };
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      "fixture-service",
    );
    await assertRejects(
      () => sendInvoiceToBillit(admin, invoiceId),
      Error,
      "BILLIT_DISABLED_IN_STAGING",
    );
  }));
