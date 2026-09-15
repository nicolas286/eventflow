import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import {
  EmailGatewayError,
  ResendEmailGateway,
} from "../_shared/modules/email-gateway/mod.ts";

Deno.test("Resend gateway preserves Eventflow attachments, tags and idempotency", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;

  const fetchMock = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json({ id: "email_123" });
  };
  const gateway = new ResendEmailGateway({
    apiKey: "test-api-key",
    fetch: fetchMock,
  });

  const result = await gateway.send({
    from: { email: "HELLO@EXAMPLE.COM", name: "Eventflow" },
    to: [{ email: "Buyer@Example.net" }],
    replyTo: [{ email: "support@example.com" }],
    subject: " Confirmation ",
    html: "<p>Confirmed</p>",
    attachments: [{
      filename: "ticket.pdf",
      content: "base64-content",
      contentType: "application/pdf",
    }],
    tags: [{ name: "kind", value: "order_confirmation" }],
    idempotencyKey: "confirmation/order-123",
  });

  assertEquals(result.providerMessageId, "email_123");
  assertEquals(requestUrl, "https://api.resend.com/emails");
  assertEquals(
    new Headers(requestInit?.headers).get("authorization"),
    "Bearer test-api-key",
  );
  assertEquals(
    new Headers(requestInit?.headers).get("idempotency-key"),
    "confirmation/order-123",
  );

  if (typeof requestInit?.body !== "string") {
    throw new Error("Expected a JSON string request body");
  }
  assertEquals(JSON.parse(requestInit.body), {
    from: "Eventflow <hello@example.com>",
    to: ["buyer@example.net"],
    reply_to: ["support@example.com"],
    subject: "Confirmation",
    html: "<p>Confirmed</p>",
    attachments: [{
      filename: "ticket.pdf",
      content: "base64-content",
      contentType: "application/pdf",
    }],
    tags: [{ name: "kind", value: "order_confirmation" }],
  });
});

Deno.test("Resend gateway exposes retryable provider errors", async () => {
  const gateway = new ResendEmailGateway({
    apiKey: "test-api-key",
    fetch: async () =>
      Response.json(
        { name: "rate_limit_exceeded", message: "Try later" },
        { status: 429 },
      ),
  });

  const error = await assertRejects(() =>
    gateway.send({
      from: { email: "hello@example.com" },
      to: [{ email: "buyer@example.net" }],
      subject: "Confirmation",
      text: "Confirmed",
    })
  );

  assertInstanceOf(error, EmailGatewayError);
  assertEquals(error.code, "rate_limit_exceeded");
  assertEquals(error.statusCode, 429);
  assertEquals(error.retryable, true);
});

Deno.test("Resend gateway rejects invalid input before calling the provider", async () => {
  let providerCalled = false;
  const gateway = new ResendEmailGateway({
    apiKey: "test-api-key",
    fetch: async () => {
      providerCalled = true;
      return Response.json({ id: "should-not-be-used" });
    },
  });

  const error = await assertRejects(() =>
    gateway.send({
      from: { email: "hello@example.com" },
      to: [{ email: "buyer@example.net" }],
      subject: "Confirmation",
    })
  );

  assertInstanceOf(error, EmailGatewayError);
  assertEquals(error.code, "INVALID_EMAIL_INPUT");
  assertEquals(providerCalled, false);
});
