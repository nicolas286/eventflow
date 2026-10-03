import { assertEquals, assertStrictEquals } from "@std/assert";
import { mapPlatformTransport } from "../platform-admin/transport.ts";

Deno.test("platform transport maps only SQL row fields and preserves business JSON keys and values", () => {
  const metadata = { first_name: "client value", nested_array: [{ custom_key: "a_b", created_at: null }], False_Value: false };
  const mapped = mapPlatformTransport("platform_admin_read", "audit", { items: [{ actor_email: "fixture@example.test", created_at: "2026-10-03", metadata }] });
  assertEquals(mapped, { items: [{ actorEmail: "fixture@example.test", createdAt: "2026-10-03", metadata }] });
  const opaque = { custom_key: metadata };
  assertStrictEquals(mapPlatformTransport("platform_admin_mutate", undefined, opaque), opaque);
});
