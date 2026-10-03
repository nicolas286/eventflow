import { assert, assertEquals } from "@std/assert";
import { handleOrdersRequest } from "../orders/index.ts";

const id = "d6100000-0000-4000-8000-000000000001";

for (const route of ["orders", "orders/admin"]) {
  Deno.test(`${route} rejects suspended organization before side effects and resumes when active`, async () => {
    const env: Record<string, string> = {
      SUPABASE_URL: "https://suspension-fixture.supabase.co",
      SUPABASE_ANON_KEY: "fixture-anon",
      SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
      RATE_LIMIT_SALT: "fixture-salt",
      APP_ENV: "staging",
      APP_BASE_URL: "https://fixture.test",
      TURNSTILE_BYPASS: "1",
    };
    const previousEnv = new Map(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
    const previousFetch = globalThis.fetch;
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    let status = "suspended";
    let suspendedAtInsert = false;
    const calls: string[] = [];
    globalThis.fetch = (input) => {
      const url = new URL(String(input));
      const name = url.pathname.split("/").at(-1) ?? "";
      calls.push(name);
      assertEquals(url.hostname, "suspension-fixture.supabase.co", "No provider should be contacted");
      if (["create_order_intent", "create_order_intent_with_terms"].includes(name)) {
        return Promise.resolve(suspendedAtInsert
          ? Response.json({ message: "ORGANIZATION_SUSPENDED", code: "42501" }, { status: 400 })
          : Response.json({ order_id: id, booking_token: "fixture-booking", total_cents: 0,
            amount_due_now_cents: 0, currency: "EUR", payment_required: false, status: "paid" }));
      }
      const data = name === "user" ? { id, email: "owner@example.test" }
        : name === "consume_rate_limit" ? [{ allowed: true, request_count: 1, retry_after_seconds: 0 }]
        : name === "platform_public_config" ? { registrationsOpen: true }
        : name === "events" ? { id, org_id: id, title: "Fixture" }
        : name === "organizations" ? { status }
        : name === "organization_members" ? { role: "owner" }
        : name === "event_products" ? [{ id, event_id: id }]
        : name === "issue_order_tickets" ? true
        : name === "claim_order_confirmation_delivery" ? { claimed: false, reason: "already_sent" }
        : null;
      return Promise.resolve(Response.json(data));
    };
    const request = () => handleOrdersRequest(new Request(`https://edge.test/${route}`, {
      method: "POST", headers: { authorization: "Bearer fixture", "content-type": "application/json" },
      body: JSON.stringify({ eventId: id, items: [{ eventProductId: id, quantity: 1 }],
        attendees: [{ eventProductId: id }], buyerEmail: "buyer@example.test",
        ...(route === "orders" ? { turnstileToken: "TEST_BYPASS", termsAccepted: true, platformTermsVersion: "2026-10-01" } : {}) }),
    }));
    try {
      const denied = await request();
      assertEquals(denied.status, 403);
      assertEquals(await denied.json(), { error: "ORGANIZATION_SUSPENDED" });
      assert(calls.every((name) => ["user", "consume_rate_limit", "platform_public_config", "events", "organizations", "organization_members"].includes(name)));
      status = "active";
      const allowed = await request();
      assertEquals(allowed.status, 200);
      assertEquals((await allowed.json()).orderId, id);
      calls.length = 0;
      suspendedAtInsert = true;
      const raced = await request();
      assertEquals(raced.status, 403);
      assertEquals(await raced.json(), { error: "ORGANIZATION_SUSPENDED" });
      assert(!calls.includes("issue_order_tickets"));
      assert(!calls.includes("apply_order_payment"));
    } finally {
      globalThis.fetch = previousFetch;
      for (const [key, value] of previousEnv) {
        if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
      }
    }
  });
}
