import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  createConsoleLogger,
  serializeError,
} from "../_shared/modules/logger/mod.ts";
import { serializeError as legacySerializeError } from "../_shared/logger.ts";

Deno.test("error serialization redacts secrets and handles cycles", () => {
  const details: Record<string, unknown> = {
    authorization: "Bearer secret-value",
    bookingToken: "booking-capability",
  };
  details.circular = details;

  const serialized = serializeError({
    message: "provider failed",
    details,
  });
  const output = JSON.stringify(serialized);

  assertStringIncludes(output, "[REDACTED]");
  assertStringIncludes(output, "[Circular]");
  assertEquals(output.includes("secret-value"), false);
  assertEquals(output.includes("booking-capability"), false);
});

Deno.test("error serialization bounds long messages", () => {
  const serialized = serializeError(new Error("x".repeat(100)), {
    maxStringLength: 20,
  });

  assertStringIncludes(String(serialized.message), "[truncated]");
});

Deno.test("secrets are removed from error messages, stacks and causes before truncation", () => {
  const secrets = [
    "sk_live_syntheticAuditOnly",
    "rk_test_syntheticAuditOnly",
    "whsec_syntheticAuditOnly",
  ];
  const error = new Error(`Stripe rejected ${secrets[0]}`, {
    cause: new Error(secrets[1]),
  });
  error.stack = `provider at ${secrets[2]}`;
  for (const serialize of [serializeError, legacySerializeError]) {
    const output = JSON.stringify(serialize(error));
    for (const secret of secrets) assertEquals(output.includes(secret), false);
    assertStringIncludes(output, "[REDACTED]");
  }
  assertEquals(
    serializeError(new Error(secrets[0]), { maxStringLength: 12 }).message,
    "[REDACTED]",
  );
});

Deno.test("structured and free-text credentials are removed without hiding payment identifiers", () => {
  const error = {
    message:
      'Authorization: Bearer opaque-credential password="multi word password"',
    code: "sk_test_syntheticCode",
    hint:
      "https://example.invalid/?booking_token=booking-capability&order=ord_123",
    details: {
      api_key: "opaque-api-key",
      "X-API-Key": "opaque-header",
      service_role_key: "opaque-role",
      nested: [{ text: "rk_live_syntheticNested" }],
      headers: new Headers({
        authorization: "Basic encoded-credential",
        "x-api-key": "opaque-header",
      }),
      paymentIntent: "pi_123",
      stripeRequestId: "req_123",
      stripeCode: "card_declined",
      status: 402,
    },
  };
  const output = JSON.stringify(
    serializeError(error, { redactedKeys: ["customSecret"] }),
  );
  for (
    const secret of [
      "opaque-credential",
      "multi word password",
      "syntheticCode",
      "booking-capability",
      "opaque-api-key",
      "opaque-header",
      "opaque-role",
      "syntheticNested",
      "encoded-credential",
    ]
  ) {
    assertEquals(output.includes(secret), false, secret);
  }
  for (const value of ["pi_123", "req_123", "card_declined", "402"]) {
    assertStringIncludes(output, value);
  }
  assertEquals(error.details.api_key, "opaque-api-key");
});

Deno.test("logger always sanitizes every level and custom redaction output without mutating data", () => {
  const outputs: unknown[][] = [];
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  for (const level of ["log", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      outputs.push(args);
    };
  }
  const input = {
    secretKey: "opaque-secret",
    nested: [new Error("whsec_syntheticNestedError")],
    orderId: "order-123",
  };
  try {
    const logger = createConsoleLogger("scope sk_live_syntheticScope", {
      requestId: "rk_live_syntheticRequest",
      redact: (data) => ({ ...data, added: "sk_test_syntheticCustom" }),
    });
    logger.info("step whsec_syntheticStep", input);
    logger.warn("warning", input);
    logger.error("failure", input);
  } finally {
    Object.assign(console, original);
  }
  assertEquals(outputs.length, 3);
  const output = JSON.stringify(outputs);
  for (
    const value of [
      "opaque-secret",
      "syntheticNestedError",
      "syntheticScope",
      "syntheticRequest",
      "syntheticCustom",
      "syntheticStep",
    ]
  ) assertEquals(output.includes(value), false, value);
  assertStringIncludes(output, "order-123");
  assertEquals(input.secretKey, "opaque-secret");
});

Deno.test("logger bounds cycles and preserves reserved correlation fields", () => {
  let output: unknown[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    output = args;
  };
  const input: Record<string, unknown> = {
    requestId: "spoofed",
    step: "spoofed",
  };
  input.circular = input;
  try {
    createConsoleLogger("audit", { requestId: "req_safe" }).info(
      "expected",
      input,
    );
  } finally {
    console.log = original;
  }
  const text = JSON.stringify(output);
  assertStringIncludes(text, "[Circular]");
  assertStringIncludes(text, "req_safe");
  assertStringIncludes(text, "expected");
  assertEquals(
    JSON.stringify(output[1]).includes('"requestId":"spoofed"'),
    false,
  );
});

Deno.test("free text redacts JWTs, private keys, URL credentials and preserves public Stripe keys", () => {
  const text = [
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.syntheticSignature",
    "https://user:opaque-password@example.invalid/path",
    "-----BEGIN PRIVATE KEY-----\nsynthetic-key-material\n-----END PRIVATE KEY-----",
    "sb_secret_syntheticSupabase",
    "pk_live_publicFixture",
  ].join(" ");
  const output = JSON.stringify(serializeError(text));
  for (
    const secret of [
      "eyJhbGci",
      "opaque-password",
      "synthetic-key-material",
      "syntheticSupabase",
    ]
  ) assertEquals(output.includes(secret), false);
  assertStringIncludes(output, "pk_live_publicFixture");
  assertStringIncludes(output, "example.invalid/path");
});
