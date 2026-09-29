import { assertEquals, assertStringIncludes } from "@std/assert";
import { serializeError } from "../_shared/modules/logger/mod.ts";

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
