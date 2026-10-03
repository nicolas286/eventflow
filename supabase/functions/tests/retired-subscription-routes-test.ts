import { assertEquals } from "@std/assert";
import { handler } from "../subscriptions/index.ts";

Deno.test("actual retired Mollie webhook routes stay 410 without provider calls", async () => {
  const previous = globalThis.fetch;
  const values: Record<string, string> = {
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
  };
  const saved = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  globalThis.fetch = () => {
    throw new Error("Retired route attempted a provider/database call");
  };
  try {
    for (const route of ["first-payment", "recurring-payment"]) {
      const response = await handler(
        new Request(
          `https://fixture.test/functions/v1/subscriptions/webhooks/${route}`,
          {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: "id=synthetic",
          },
        ),
      );
      assertEquals(response.status, 410);
      assertEquals(await response.json(), {
        error: "MOLLIE_HISTORY_READ_ONLY",
      });
    }
  } finally {
    globalThis.fetch = previous;
    for (const [key, value] of saved) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
