import { assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { expireOrders } from "../workers/expire-orders.ts";
import { runInBackground } from "../_shared/app/background.ts";

Deno.test("expiry worker rejects invalid cron secrets without leaking the expected secret or calling RPC", async () => {
  const previous = Deno.env.get("CRON_SECRET");
  Deno.env.set("CRON_SECRET", "synthetic-private-cron-key");
  let calls = 0;
  const admin = createClient("https://synthetic.supabase.co", "synthetic-key", {
    global: {
      fetch: () => {
        calls++;
        return Promise.resolve(Response.json([]));
      },
    },
    auth: { persistSession: false },
  });
  try {
    const response = await expireOrders(
      new Request("https://edge.test/workers/expire-orders", {
        method: "POST",
        headers: { "x-cron-secret": "wrong-key" },
      }),
      admin,
    );
    assertEquals(response.status, 401);
    assertEquals(await response.json(), { ok: false, error: "Unauthorized" });
    assertEquals(calls, 0);
  } finally {
    if (previous === undefined) Deno.env.delete("CRON_SECRET");
    else Deno.env.set("CRON_SECRET", previous);
  }
});

Deno.test("expiry worker keeps batch size and response after valid cron authentication", async () => {
  const previous = Deno.env.get("CRON_SECRET");
  Deno.env.set("CRON_SECRET", "synthetic-private-cron-key");
  const admin = createClient("https://synthetic.supabase.co", "synthetic-key", {
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        assertEquals(
          new URL(request.url).pathname,
          "/rest/v1/rpc/expire_orders",
        );
        assertEquals(await request.json(), { p_limit: 200 });
        return Response.json([{ id: "synthetic-order" }]);
      },
    },
    auth: { persistSession: false },
  });
  try {
    const response = await expireOrders(
      new Request("https://edge.test/workers/expire-orders", {
        method: "POST",
        headers: { "x-cron-secret": "synthetic-private-cron-key" },
      }),
      admin,
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      ok: true,
      expiredCount: 1,
      data: [{ id: "synthetic-order" }],
    });
  } finally {
    if (previous === undefined) Deno.env.delete("CRON_SECRET");
    else Deno.env.set("CRON_SECRET", previous);
  }
});

Deno.test("background work awaits completion outside Supabase runtime", async () => {
  let completed = false;
  await runInBackground(
    Promise.resolve().then(() => {
      completed = true;
    }),
  );
  assertEquals(completed, true);
});
