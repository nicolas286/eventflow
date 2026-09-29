import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  bankTransferCommunication,
  bankTransferPaymentId,
} from "../orders/public/bank-transfer.ts";
import { buildBankTransferInstructionsHtml } from "../_shared/services/order-confirmation/templates/bank-transfer-instructions.ts";

const orderId = "11111111-1111-4111-8111-111111111111";

Deno.test("bank transfer references remain deterministic per order", () => {
  assertEquals(bankTransferPaymentId(orderId), `bank_transfer:${orderId}`);
  assertEquals(bankTransferCommunication(orderId), "EVENTFLOW 11111111");
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
    communication: "EVENTFLOW 11111111",
  });

  assertStringIncludes(html, "25,99");
  assertStringIncludes(html, "BE51732081025262");
  assertStringIncludes(html, "EVENTFLOW 11111111");
  assertStringIncludes(html, "ASBL &lt;Demo&gt;");
  assertEquals(html.includes("ASBL <Demo>"), false);
});
