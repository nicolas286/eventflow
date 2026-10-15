import { assert, assertEquals, assertRejects } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { runCron } from "../_shared/services/order-reminders/index.ts";
import { ResponseError } from "../_shared/errors.ts";

const fixtureUrl = "https://reminder-fixture.supabase.co";
const logger = {
  requestId: "reminder-fixture",
  info() {},
  warn() {},
  error() {},
};

function order(index: number, startsAt: Date, orgId = "enabled-org") {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event_id: "fixture-event",
    status: "paid",
    buyer_email: "buyer@example.test",
    booking_token: "synthetic-booking-token",
    currency: "EUR",
    total_cents: 1000,
    paid_cents: 1000,
    events: {
      id: "fixture-event",
      org_id: orgId,
      title: "Synthetic event",
      description: null,
      starts_at: startsAt.toISOString(),
      location: null,
    },
  };
}

type FixtureOrder = ReturnType<typeof order>;

async function fixture(
  orders: FixtureOrder[],
  run: (ctx: {
    execute: () => ReturnType<typeof runCron>;
    queries: URL[];
    sent: string[];
    logged: Set<string>;
  }) => Promise<void>,
  failPage = 0,
) {
  const values: Record<string, string> = {
    APP_ENV: "staging",
    MAIL_MODE: "capture",
    SUPABASE_URL: fixtureUrl,
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  };
  const previous = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  const previousFetch = globalThis.fetch;
  const queries: URL[] = [];
  const sent: string[] = [];
  const logged = new Set<string>();
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);

  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    assertEquals(url.origin, fixtureUrl);
    if (url.pathname.endsWith("/list_pending_bank_transfer_emails")) {
      return Response.json([]);
    }
    if (url.pathname === "/rest/v1/orders") {
      queries.push(url);
      if (queries.length === failPage) {
        return Response.json({ message: "Synthetic page failure" }, {
          status: 500,
        });
      }
      const params = url.searchParams;
      const statuses = params.get("status") ?? "";
      const after = params.get("id")?.replace(/^gt\./, "");
      const lower = params.get("events.starts_at")?.replace(/^gt\./, "");
      const upper = params.getAll("events.starts_at")
        .find((value) => value.startsWith("lte."))?.slice(4);
      const rows = orders.filter((row) =>
        statuses.includes(row.status) &&
        (!after || row.id > after) &&
        (!params.get("select")?.includes("!inner") ||
          ((!lower || new Date(row.events.starts_at) > new Date(lower)) &&
            (!upper || new Date(row.events.starts_at) <= new Date(upper))))
      );
      if (params.get("order") === "id.asc") {
        rows.sort((a, b) => a.id.localeCompare(b.id));
      }
      return Response.json(rows.slice(0, Number(params.get("limit") ?? 1000)));
    }
    if (url.pathname === "/rest/v1/organization_profile") {
      return Response.json([
        { org_id: "enabled-org", email_reminder_days_before: 3 },
        { org_id: "disabled-org", email_reminder_days_before: 0 },
      ]);
    }
    if (url.pathname.endsWith("/log_email_once")) {
      const body = await request.json();
      assertEquals(body.p_kind, "reminder_v1");
      if (logged.has(body.p_order_id)) return Response.json(false);
      logged.add(body.p_order_id);
      return Response.json(true);
    }
    if (
      url.pathname === "/rest/v1/order_items" ||
      url.pathname === "/rest/v1/promo_code_redemptions"
    ) return Response.json([]);
    if (url.pathname.startsWith("/storage/v1/object/mail-previews/")) {
      const body = await request.json();
      assertEquals(body.payload.tags.kind, "reminder_v1");
      sent.push(body.payload.tags.orderId);
      return Response.json({});
    }
    throw new Error(`Unexpected fixture request: ${url.pathname}`);
  };
  const admin = createClient(fixtureUrl, "fixture-service", {
    global: { fetch: (input, init) => globalThis.fetch(input, init) },
  });
  try {
    await run({
      execute: () =>
        runCron({ admin, logger, appBaseUrl: "https://fixture.test" }),
      queries,
      sent,
      logged,
    });
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

Deno.test("reminder cron reaches all due orders beyond 250 old orders without resending", async () => {
  const now = new Date();
  const due = new Date(now);
  due.setUTCDate(due.getUTCDate() + 3);
  const past = new Date(now.getTime() - 3_600_000);
  const later = new Date(now.getTime() + 10 * 86_400_000);
  const outsideHorizon = new Date(now.getTime() + 61 * 86_400_000);
  const oldOrders = Array.from({ length: 300 }, (_, i) => order(i + 1, past));
  const dueOrders = Array.from({ length: 251 }, (_, i) => order(i + 301, due));
  const cancelled = { ...order(554, due), status: "cancelled" };
  await fixture([
    ...oldOrders,
    ...dueOrders,
    order(552, later),
    order(553, due, "disabled-org"),
    cancelled,
    order(555, outsideHorizon),
  ], async ({ execute, sent, queries, logged }) => {
    logged.add(dueOrders[0].id);
    const result = await execute();
    assertEquals(result.scanned, 253);
    assertEquals(result.eligible, 251);
    assertEquals(result.sent, 250);
    assertEquals(result.skippedAlreadySent, 1);
    assertEquals(result.skippedNoReminder, 1);
    assertEquals(sent, dueOrders.slice(1).map((row) => row.id));
    assertEquals(queries.length, 2);
    for (const query of queries) {
      assert(query.searchParams.get("select")?.includes("events:events!inner"));
      assertEquals(query.searchParams.get("order"), "id.asc");
      assertEquals(query.searchParams.get("limit"), "250");
      assert(
        query.searchParams.getAll("events.starts_at").some((v) =>
          v.startsWith("gt.")
        ),
      );
      assert(
        query.searchParams.getAll("events.starts_at").some((v) =>
          v.startsWith("lte.")
        ),
      );
    }
    assertEquals(queries[1].searchParams.get("id"), `gt.${dueOrders[249].id}`);
    const repeated = await execute();
    assertEquals(repeated.sent, 0);
    assertEquals(repeated.skippedAlreadySent, 251);
    assertEquals(sent.length, 250);
  });
});

Deno.test("reminder cron excludes a batch consisting entirely of past events", async () => {
  const past = new Date(Date.now() - 1000);
  await fixture(
    [order(1, past)],
    async ({ execute, sent, logged, queries }) => {
      const result = await execute();
      assertEquals(result.scanned, 0);
      assertEquals(result.sent, 0);
      assertEquals(sent, []);
      assertEquals(logged.size, 0);
      assertEquals(queries.length, 1);
    },
  );
});

Deno.test("reminder cron fails before sending if a later candidate page fails", async () => {
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 3);
  await fixture(
    Array.from({ length: 251 }, (_, i) => order(i + 1, due)),
    async ({ execute, sent, logged }) => {
      const error = await assertRejects(execute);
      assert(error instanceof ResponseError);
      assertEquals(error.code, "REMINDER_ORDERS_LOAD_FAILED");
      assertEquals(sent, []);
      assertEquals(logged.size, 0);
    },
    2,
  );
});
