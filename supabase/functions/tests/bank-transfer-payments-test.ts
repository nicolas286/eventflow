import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  bankTransferCommunication,
  createBankTransferPaymentOrThrow,
  bankTransferInternalReference,
  bankTransferPaymentId,
} from "../orders/public/bank-transfer.ts";
import { buildBankTransferInstructionsHtml } from "../_shared/services/order-confirmation/templates/bank-transfer-instructions.ts";

const orderId = "11111111-1111-4111-8111-111111111111";

Deno.test("bank transfer references remain deterministic per order", () => {
  assertEquals(bankTransferPaymentId(orderId), `bank_transfer:${orderId}`);
  assertEquals(
    bankTransferInternalReference(orderId),
    "EF-11111111111141118111111111111111",
  );
  assertEquals(
    bankTransferCommunication({
      orderId,
      eventTitle: "Concert de rentrée",
      buyerEmail: "participant@example.com",
    }),
    "EVENTFLOW | Concert de rentrée | participant@example.com | EF-11111111111141118111111111111111",
  );
  assertEquals(
    bankTransferInternalReference("22222222-2222-4222-8222-222222222222") ===
      bankTransferInternalReference(orderId),
    false,
  );
});

Deno.test("bank transfer email contains instructions and escapes organizer data", () => {
  const html = buildBankTransferInstructionsHtml({
    eventTitle: "Concert <été>",
    startsAt: null,
    location: null,
    orderUrl: "https://eventflow.test/order/example?token=secret",
    amountCents: 2599,
    currency: "EUR",
    beneficiary: "ASBL <Demo>",
    iban: "BE51732081025262",
    communication: "EVENTFLOW | Concert | participant@example.com | EF-11111111111141118111111111111111",
    internalReference: "EF-11111111111141118111111111111111",
    paymentDueAt: null,
  });

  assertStringIncludes(html, "25,99");
  assertStringIncludes(html, "BE51732081025262");
  assertStringIncludes(html, "participant@example.com");
  assertStringIncludes(html, "EF-11111111111141118111111111111111");
  assertStringIncludes(html, "ASBL &lt;Demo&gt;");
  assertStringIncludes(html, "Concert &lt;été&gt;");
  assertEquals(html.includes("ASBL <Demo>"), false);
});

Deno.test("bank transfer failures never write a full IBAN to logs", async () => {
  const captured: unknown[] = [];
  const logger = {
    requestId: "fixture",
    info: (_step: string, data?: unknown) => captured.push(data),
    warn: (_step: string, data?: unknown) => captured.push(data),
    error: (_step: string, data?: unknown) => captured.push(data),
  };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: () => Promise.resolve({
      data: null,
      error: { message: "fixture order failure" },
    }),
  };
  const admin = {
    rpc: () => Promise.resolve({
      data: {
        internalReference: "EF-11111111111141118111111111111111",
        communication: "EVENTFLOW | Concert | participant@example.com | EF-11111111111141118111111111111111",
        beneficiary: "Sensitive Beneficiary",
        iban: "BE51732081025262",
        amountCents: 2599,
        currency: "EUR",
      },
      error: null,
    }),
    from: () => query,
  };

  await createBankTransferPaymentOrThrow({
    admin: admin as never,
    logger,
    orderId,
    amountCents: 2599,
    currency: "EUR",
    beneficiary: "Sensitive Beneficiary",
    iban: "BE51732081025262",
    eventTitle: "Concert",
    buyerEmail: "participant@example.com",
  });

  const serializedLogs = JSON.stringify(captured);
  assertEquals(serializedLogs.includes("BE51732081025262"), false);
  assertEquals(serializedLogs.includes("Sensitive Beneficiary"), false);
});
