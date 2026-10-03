import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { handleOrdersRequest } from "../orders/index.ts";
const actor = "b3100000-0000-4000-8000-000000000001",
  org = "b3100000-0000-4000-8000-000000000011",
  foreignOrg = "b3100000-0000-4000-8000-000000000012";
const event = "b3100000-0000-4000-8000-000000000021",
  foreignEvent = "b3100000-0000-4000-8000-000000000022",
  order = "b3100000-0000-4000-8000-000000000041",
  attendee = "b3100000-0000-4000-8000-000000000061";
const empty = {
  orders: { limit: 50, offset: 0, total: 0, rows: [] },
  orderItems: [],
  payments: [],
  attendees: [],
  attendeeAnswers: [],
};
const families = [
  { route: "tickets-list", body: { eventId: event } },
  { route: "ticket-check-in", body: { eventId: event, ticketId: attendee } },
  {
    route: "ticket-check-in-qr",
    body: { eventId: event, qrToken: "synthetic-qr" },
  },
  { route: "list", body: { eventId: event } },
  {
    route: "search",
    body: { eventId: event, query: "same", filterMode: "all" },
  },
  { route: "tickets-search", body: { eventId: event, query: "same" } },
  { route: "participants-export", body: { eventId: event } },
  {
    route: "participant-update",
    body: {
      attendeeId: attendee,
      attendee: {
        answers: [{
          fieldKey: "name",
          value: { value_text: " Original ", Nested_Key: { camelKey: 3 } },
        }],
      },
    },
  },
  { route: "delete", body: { orderId: order } },
  { route: "bank-summaries", body: { eventId: event } },
  { route: "bank-expire", body: { orderId: order } },
];
type Options = {
  invalidSession?: boolean;
  foreign?: boolean;
  quota?: "denied" | "unavailable";
  malformed?: boolean;
};
async function fixture(
  options: Options,
  run: (calls: { path: string; body: unknown }[]) => Promise<void>,
) {
  const env = {
    SUPABASE_URL: "https://b3-fixture.invalid",
    SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    RATE_LIMIT_SALT: "synthetic-b3-salt",
  };
  const previous = new Map(Object.keys(env).map((k) => [k, Deno.env.get(k)]));
  const oldFetch = globalThis.fetch;
  const calls: { path: string; body: unknown }[] = [];
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init),
      url = new URL(req.url),
      text = await req.text();
    const body: unknown = text ? JSON.parse(text) : null;
    calls.push({ path: url.pathname, body });
    if (url.pathname === "/auth/v1/user") {
      return options.invalidSession
        ? Response.json({ message: "invalid" }, { status: 401 })
        : Response.json({
          id: actor,
          user_metadata: { orgId: foreignOrg, role: "owner" },
        });
    }
    assertEquals(req.headers.get("authorization"), "Bearer synthetic-service");
    assertEquals(req.headers.get("apikey"), "synthetic-service");
    if (url.pathname === "/rest/v1/events") {
      return Response.json({
        id: options.foreign ? foreignEvent : event,
        org_id: options.foreign ? foreignOrg : org,
      });
    }
    if (url.pathname === "/rest/v1/orders") {
      return Response.json({
        id: order,
        event_id: options.foreign ? foreignEvent : event,
        org_id: options.foreign ? foreignOrg : org,
      });
    }
    if (url.pathname === "/rest/v1/order_attendees") {
      return Response.json({ order_id: order });
    }
    if (url.pathname === "/rest/v1/organization_members") {
      assertEquals(url.searchParams.get("user_id"), `eq.${actor}`);
      return Response.json(
        url.searchParams.get("org_id") === `eq.${org}`
          ? { role: "admin" }
          : null,
      );
    }
    if (url.pathname.endsWith("/consume_rate_limit")) {
      return options.quota === "unavailable"
        ? Response.json({ message: "private" }, { status: 500 })
        : Response.json([{
          allowed: options.quota !== "denied",
          request_count: 1,
          retry_after_seconds: options.quota === "denied" ? 17 : 0,
        }]);
    }
    const args = z.record(z.string(), z.unknown()).parse(body);
    assertEquals(args.p_org_id, org);
    assertEquals(args.p_event_id, event);
    if (options.malformed) {
      return Response.json({ private_details: "never show" });
    }
    if (url.pathname.endsWith("/organizer_admin_update_order_attendee")) {
      assertEquals(args.p_actor_id, actor);
      assertEquals(args.p_attendee, {
        answers: [{
          field_key: "name",
          value: { value_text: " Original ", Nested_Key: { camelKey: 3 } },
        }],
      });
      return Response.json({ attendee_id: attendee, updated_answers_count: 1 });
    }
    if (url.pathname.endsWith("/organizer_admin_delete_order")) {
      assertEquals(args.p_actor_id, actor);
      return Response.json({
        deleted_order_id: order,
        released: { reserved_units: 1, sold_units: 0 },
      });
    }
    if (url.pathname.endsWith("/organizer_expire_bank_transfer_order")) {
      assertEquals(args.p_actor_id, actor);
      return Response.json({
        ok: true,
        orderId: order,
        status: "expired",
        releasedUnits: 1,
        idempotent: false,
      });
    }
    if (url.pathname.endsWith("/organizer_get_bank_transfer_admin_summaries")) {
      return Response.json([]);
    }
    if (url.pathname.includes("/organizer_check_in_ticket")) {
      assertEquals(args.p_actor_id, actor);
      return Response.json({
        ok: true,
        outcome: "validated",
        ticketId: attendee,
        eventId: event,
        orderId: order,
        ticketIndex: 1,
        qrToken: "synthetic-qr",
        status: "checked_in",
        checkedInAt: "2026-10-03T12:00:00Z",
        checkedInBy: actor,
      });
    }
    if (
      url.pathname.endsWith("/organizer_get_event_tickets_admin") ||
      url.pathname.endsWith("/organizer_search_event_admin_tickets_view")
    ) {
      return Response.json({
        tickets: { limit: 50, offset: 0, total: 0, rows: [] },
      });
    }
    if (
      url.pathname.endsWith(
        "/organizer_get_event_admin_participants_export_data",
      )
    ) return Response.json({ ...empty, nextCursor: null });
    return Response.json(empty);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [k, v] of previous) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
}
async function call(
  route: string,
  body: unknown,
  token: string | null = "synthetic-user",
) {
  return await handleOrdersRequest(
    new Request(`https://edge.invalid/functions/v1/orders/admin/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}
for (const family of families) {
  Deno.test(`B3/B4 ${family.route}: verified actor/service client, auth, cross-tenant, quotas and strict input`, async () => {
    await fixture({}, async (calls) => {
      assertEquals((await call(family.route, family.body)).status, 200);
      assert(calls.some((c) => c.path.includes("/rpc/organizer_")));
    });
    await fixture({}, async (calls) => {
      assertEquals((await call(family.route, family.body, null)).status, 401);
      assert(!calls.some((c) => c.path.includes("/rpc/")));
    });
    await fixture({ invalidSession: true }, async (calls) => {
      assertEquals((await call(family.route, family.body)).status, 401);
      assert(!calls.some((c) => c.path.includes("/rpc/")));
    });
    await fixture({ foreign: true }, async (calls) => {
      assertEquals((await call(family.route, family.body)).status, 403);
      assert(!calls.some((c) => c.path.includes("/rpc/")));
    });
    for (const quota of ["denied", "unavailable"] as const) {
      await fixture({ quota }, async (calls) => {
        assertEquals(
          (await call(family.route, family.body)).status,
          quota === "denied" ? 429 : 503,
        );
        assert(
          !calls.some((c) => c.path.includes("/rpc/organizer_")),
        );
      });
    }
    await fixture({}, async (calls) => {
      assertEquals(
        (await call(family.route, { ...family.body, paidCents: 1 })).status,
        400,
      );
      assert(!calls.some((c) => c.path.includes("/rpc/")));
    });
    await fixture({ malformed: true }, async () => {
      const response = await call(family.route, family.body);
      assertEquals(response.status, 500);
      assertEquals(await response.json(), { error: "UNEXPECTED_ERROR" });
    });
  });
}
Deno.test("B3 resource references and parameter bounds are enforced before transaction", async () => {
  for (
    const [route, body] of [
      ["list", { eventId: event, orgId: foreignOrg }],
      ["delete", { orderId: order, eventId: foreignEvent }],
      ["participant-update", {
        attendeeId: attendee,
        eventId: foreignEvent,
        attendee: { answers: [] },
      }],
    ] as const
  ) {
    await fixture({}, async (calls) => {
      assertEquals((await call(route, body)).status, 403);
      assert(!calls.some((c) => c.path.includes("/rpc/organizer_")));
    });
  }
  for (
    const [route, body] of [
      ["list", { eventId: event, ordersLimit: 1001 }],
      ["search", { eventId: event, query: "x".repeat(501), filterMode: "all" }],
      ["participants-export", { eventId: event, limit: 101 }],
      ["bank-summaries", { eventId: event, limit: 101 }],
      ["participant-update", {
        attendeeId: attendee,
        attendee: { status: "paid", answers: [] },
      }],
    ] as const
  ) {
    await fixture(
      {},
      async () => assertEquals((await call(route, body)).status, 400),
    );
  }
});
