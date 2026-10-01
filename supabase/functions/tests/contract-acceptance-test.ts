import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { buildAcceptedContractHtml } from "../_shared/services/ticket-confirmation/contract.ts";
import { parseRegisterPayload } from "../orders/public/validation.ts";
import { ResponseError } from "../_shared/errors.ts";
import { DEFAULT_ORGANIZATION_SALES_TERMS } from "../../../shared/schemas/organization-sales-terms.ts";
import {
  CONNECT_TERMS_TEXT,
  DPA_TEXT,
  EVENTFLOW_PRIVACY_TEXT,
  EVENTFLOW_TERMS_TEXT,
} from "../../../shared/legal/documents.ts";

const payload = {
  eventId: "11111111-1111-4111-8111-111111111111",
  items: [{
    eventProductId: "22222222-2222-4222-8222-222222222222",
    quantity: 1,
  }],
  attendees: [],
  buyer: { email: "fixture@example.test" },
  turnstileToken: "fixture",
  termsAccepted: true,
};

Deno.test("old checkout clients must reload before an acceptance can be recorded", async () => {
  for (const extra of [{}, { platformTermsVersion: "2026-09-29" }]) {
    const error = await assertRejects(
      () =>
        parseRegisterPayload(
          new Request("https://fixture.test", {
            method: "POST",
            body: JSON.stringify({ ...payload, ...extra }),
          }),
        ),
      ResponseError,
    );
    assertEquals(error.status, 409);
    assertEquals(error.code, "TERMS_CHANGED_RELOAD");
  }
});

Deno.test("free checkout accepts platform terms without claiming organizer acceptance", async () => {
  const parsed = await parseRegisterPayload(
    new Request("https://fixture.test", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        platformTermsVersion: "2026-10-01",
        organizerSalesTermsVersion: null,
      }),
    }),
  );
  assertEquals(parsed.organizerSalesTermsVersion, null);
});

Deno.test("confirmation contains the stored text and seller, safely escaped", () => {
  const html = buildAcceptedContractHtml({
    platformVersion: "v1",
    platformText: "Platform historical terms",
    organizerVersion: "custom-v1",
    organizerText: "Seller historical terms <script>alert(1)</script>",
    seller: { legal_name: "Historical seller", email: "old@example.test" },
    acceptedAt: "2026-10-01T12:00:00Z",
  });
  assertStringIncludes(html, "Platform historical terms");
  assertStringIncludes(html, "Historical seller");
  assertStringIncludes(html, "old@example.test");
  assertStringIncludes(html, "&lt;script&gt;");
  assertEquals(html.includes("<script>"), false);
});

Deno.test("resending historical orders does not invent a contract acceptance", () => {
  assertEquals(
    buildAcceptedContractHtml({
      platformVersion: null,
      platformText: null,
      organizerVersion: null,
      organizerText: null,
      seller: null,
      acceptedAt: null,
    }),
    "",
  );
});

Deno.test("new organizer defaults match the text offered in the editor", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../migrations/20261001090205_strengthen_contract_acceptance.sql",
      import.meta.url,
    ),
  );
  assertStringIncludes(
    migration.replace(/\r\n/g, "\n"),
    `$sales$${DEFAULT_ORGANIZATION_SALES_TERMS}$sales$`,
  );
});

Deno.test("seller evidence archives the exact four documents presented to the signer", async () => {
  const migration = (await Deno.readTextFile(
    new URL(
      "../../migrations/20261001090205_strengthen_contract_acceptance.sql",
      import.meta.url,
    ),
  )).replace(/\r\n/g, "\n");
  const documents = {
    platform_terms: EVENTFLOW_TERMS_TEXT,
    privacy: EVENTFLOW_PRIVACY_TEXT,
    connect: CONNECT_TERMS_TEXT,
    dpa: DPA_TEXT,
  };
  for (const [key, body] of Object.entries(documents)) {
    assertStringIncludes(
      migration,
      `values ('${key}','2026-10-01',$document$${body}$document$)`,
    );
  }
});
