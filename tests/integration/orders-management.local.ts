import { z } from "zod";
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleOrdersRequest } from "../../supabase/functions/orders/index.ts";
import { hashRateLimitKey } from "../../supabase/functions/_shared/modules/supabase-rate-limit/hash-key.ts";
import {
  adminDeleteOrderResultSchema,
  adminUpdateOrderAttendeeResultSchema,
  bankSummariesPageSchema,
  eventAdminOrdersViewSchema,
  getEventTicketsAdminResponseSchema,
  participantsExportCursorSchema,
  participantsExportPageSchema,
} from "../../shared/schemas/orders-management.ts";
import { expireBankTransferOrderResultSchema } from "../../shared/schemas/bank-transfer.ts";
function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing synthetic ${name}`);
  return value;
}
Deno.test("B3 real Auth/HTTP/PostgREST without business RLS: all families, 1005-order export, tenants and closed browser access", async () => {
  const base = env("SUPABASE_URL");
  assertEquals(new URL(base).hostname, "127.0.0.1");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(base, env("SUPABASE_SERVICE_ROLE_KEY"), options);
  const users: string[] = [], orgs: string[] = [];
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, handleOrdersRequest);
  const origin =
    `http://127.0.0.1:${server.addr.port}/functions/v1/orders/admin`;
  async function actor() {
    const email = `b3-${crypto.randomUUID()}@example.test`,
      password = `Synthetic-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        platform_terms_version: "2026-10-01",
        platform_terms_accepted: true,
      },
    });
    assert(!created.error && created.data.user);
    users.push(created.data.user.id);
    const client = createClient(base, env("SUPABASE_ANON_KEY"), options),
      signed = await client.auth.signInWithPassword({ email, password });
    assert(!signed.error && signed.data.session);
    return {
      id: created.data.user.id,
      token: signed.data.session.access_token,
      client,
    };
  }
  async function insert(table: string, rows: object[]) {
    const r = await service.from(table).insert(rows);
    assert(!r.error, `${table}: ${r.error?.code}`);
  }
  async function call(
    route: string,
    body: unknown,
    token: string | null,
    status = 200,
  ) {
    const response = await fetch(`${origin}/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const result: unknown = await response.json();
    assertEquals(
      response.status,
      status,
      `${route}: ${JSON.stringify(result)}`,
    );
    return result;
  }
  try {
    const a = await actor(), b = await actor(), admin = await actor();
    const orgA = crypto.randomUUID(),
      orgB = crypto.randomUUID(),
      eventA = crypto.randomUUID(),
      eventB = crypto.randomUUID(),
      productA = crypto.randomUUID(),
      productB = crypto.randomUUID(),
      fieldA = crypto.randomUUID(),
      fieldB = crypto.randomUUID();
    orgs.push(orgA, orgB);
    await insert("organizations", [{
      id: orgA,
      type: "association",
      name: "B3 A",
      plan: "pro",
      plan_expires_at: "2099-01-01",
    }, {
      id: orgB,
      type: "association",
      name: "B3 B",
      plan: "pro",
      plan_expires_at: "2099-01-01",
    }]);
    await insert("organization_members", [
      { org_id: orgA, user_id: a.id, role: "owner" },
      { org_id: orgB, user_id: b.id, role: "owner" },
      { org_id: orgA, user_id: admin.id, role: "admin" },
    ]);
    await insert("events", [{
      id: eventA,
      org_id: orgA,
      slug: "b3-a",
      title: "B3 A",
    }, { id: eventB, org_id: orgB, slug: "b3-b", title: "B3 B" }]);
    await insert("event_products", [{
      id: productA,
      event_id: eventA,
      name: "B3 Ticket",
      price_cents: 100,
      stock_qty: 2000,
      reserved_qty: 1004,
      sold_qty: 1,
    }, {
      id: productB,
      event_id: eventB,
      name: "B3 B Ticket",
      price_cents: 100,
      stock_qty: 10,
      reserved_qty: 1,
      sold_qty: 0,
    }]);
    await insert("event_form_fields", [{
      id: fieldA,
      event_id: eventA,
      field_key: "identity",
      label: "Identity",
      field_type: "text",
      is_active: true,
    }, {
      id: fieldB,
      event_id: eventB,
      field_key: "foreign",
      label: "Foreign",
      field_type: "text",
      is_active: true,
    }]);
    const orderIds = Array.from({ length: 1005 }, () => crypto.randomUUID()),
      attendeeIds = orderIds.map(() => crypto.randomUUID());
    for (let start = 0; start < orderIds.length; start += 100) {
      const ids = orderIds.slice(start, start + 100);
      await insert(
        "orders",
        ids.map((id, i) => ({
          id,
          org_id: orgA,
          event_id: eventA,
          currency: "EUR",
          total_cents: 100,
          paid_cents: start + i === 1 ? 100 : 0,
          buyer_email: `b3-${start + i}@example.test`,
          booking_token: `synthetic-${id}`,
          status: start + i === 1 ? "paid" : "awaiting_payment",
          confirmed_at: start + i === 1 ? new Date().toISOString() : null,
        })),
      );
      await insert(
        "order_items",
        ids.map((id) => ({
          id: crypto.randomUUID(),
          order_id: id,
          product_id: productA,
          product_name_snapshot: "B3 Ticket",
          unit_price_cents_snapshot: 100,
          quantity: 1,
        })),
      );
      await insert(
        "order_attendees",
        ids.map((id, i) => ({
          id: attendeeIds[start + i],
          order_id: id,
          product_id: productA,
          product_name_snapshot: "B3 Ticket",
          attendee_index: 1,
          status: start + i === 1 ? "confirmed" : "reserved",
        })),
      );
    }
    const foreignOrder = crypto.randomUUID(),
      foreignAttendee = crypto.randomUUID();
    await insert("orders", [{
      id: foreignOrder,
      org_id: orgB,
      event_id: eventB,
      currency: "EUR",
      total_cents: 100,
      paid_cents: 0,
      buyer_email: "b3-b@example.test",
      booking_token: `synthetic-${foreignOrder}`,
      status: "awaiting_payment",
    }]);
    await insert("order_items", [{
      id: crypto.randomUUID(),
      order_id: foreignOrder,
      product_id: productB,
      product_name_snapshot: "B3 B Ticket",
      unit_price_cents_snapshot: 100,
      quantity: 1,
    }]);
    await insert("order_attendees", [{
      id: foreignAttendee,
      order_id: foreignOrder,
      product_id: productB,
      product_name_snapshot: "B3 B Ticket",
      attendee_index: 1,
      status: "reserved",
    }]);
    for (const id of [orderIds[0], foreignOrder]) {
      const r = await service.rpc("create_bank_transfer_payment", {
        p_order_id: id,
        p_amount_cents: 100,
        p_currency: "EUR",
        p_beneficiary: "Synthetic B3",
        p_iban: "BE51732081025262",
        p_communication: `B3 ${id}`,
        p_internal_reference: `B3-${id}`,
      });
      assert(!r.error);
    }
    assert(
      !(await service.rpc("issue_order_tickets", { p_order_id: orderIds[1] }))
        .error,
    );
    const families = [
      { route: "list", own: { eventId: eventA }, foreign: { eventId: eventB } },
      {
        route: "search",
        own: { eventId: eventA, query: "b3", filterMode: "order" },
        foreign: { eventId: eventB, query: "b3", filterMode: "order" },
      },
      {
        route: "tickets-search",
        own: { eventId: eventA, query: "" },
        foreign: { eventId: eventB, query: "" },
      },
      {
        route: "participants-export",
        own: { eventId: eventA },
        foreign: { eventId: eventB },
      },
      {
        route: "participant-update",
        own: { attendeeId: attendeeIds[0], attendee: { answers: [] } },
        foreign: { attendeeId: foreignAttendee, attendee: { answers: [] } },
      },
      {
        route: "delete",
        own: { orderId: orderIds[2] },
        foreign: { orderId: foreignOrder },
      },
      {
        route: "bank-summaries",
        own: { eventId: eventA },
        foreign: { eventId: eventB },
      },
      {
        route: "bank-expire",
        own: { orderId: orderIds[0] },
        foreign: { orderId: foreignOrder },
      },
    ];
    for (const f of families) {
      await call(f.route, f.own, null, 401);
      await call(f.route, f.own, "invalid", 401);
      await call(f.route, f.foreign, a.token, 403);
      await call(f.route, { ...f.own, paidCents: 7 }, a.token, 400);
      await call(f.route, { ...f.own, orgId: orgB }, a.token, 403);
    }
    const first = eventAdminOrdersViewSchema.parse(
      await call("list", { eventId: eventA, ordersLimit: 25 }, a.token),
    );
    assertEquals(first.orders.total, 1005);
    assertEquals(first.orders.rows.length, 25);
    const second = eventAdminOrdersViewSchema.parse(
      await call(
        "list",
        { eventId: eventA, ordersLimit: 25, ordersOffset: 25 },
        a.token,
      ),
    );
    assert(
      !first.orders.rows.some((r) =>
        second.orders.rows.some((s) => s.id === r.id)
      ),
    );
    await call("list", { orgId: orgA, eventSlug: "b3-a" }, admin.token);
    await call("list", { eventId: eventB }, b.token);
    const searched = eventAdminOrdersViewSchema.parse(
      await call("search", {
        eventId: eventA,
        query: "b3-999@example.test",
        filterMode: "order",
      }, a.token),
    );
    assertEquals(searched.orders.total, 1);
    assertEquals(
      getEventTicketsAdminResponseSchema.parse(
        await call("tickets-search", { eventId: eventA, query: "" }, a.token),
      ).tickets.total,
      1,
    );
    let cursor: z.infer<typeof participantsExportCursorSchema> | null = null;
    const seen = new Set<string>();
    let attendeeCount = 0, pages = 0;
    do {
      const page = participantsExportPageSchema.parse(
        await call("participants-export", {
          eventId: eventA,
          confirmedOnly: false,
          limit: 100,
          cursor,
        }, a.token),
      );
      pages++;
      for (const r of page.orders.rows) {
        assertEquals(r.orgId, orgA);
        assert(!seen.has(r.id));
        seen.add(r.id);
      }
      attendeeCount += page.attendees.length;
      cursor = page.nextCursor;
    } while (cursor);
    assertEquals(pages, 11);
    assertEquals(seen.size, 1005);
    assertEquals(attendeeCount, 1005);
    const business = {
      value_text: " =SUM(1,2) ",
      Nested_Key: { CamelKey: 1, snake_key: [" Raw ", false] },
    };
    adminUpdateOrderAttendeeResultSchema.parse(
      await call("participant-update", {
        attendeeId: attendeeIds[0],
        attendee: { answers: [{ eventFormFieldId: fieldA, value: business }] },
      }, a.token),
    );
    const answer = await service.from("order_attendee_answers").select("value")
      .eq("attendee_id", attendeeIds[0]).single();
    assertEquals(answer.data?.value, business);
    await call(
      "participant-update",
      {
        attendeeId: attendeeIds[0],
        attendee: {
          answers: [{
            eventFormFieldId: fieldB,
            fieldKey: "identity",
            valueText: "foreign",
          }],
        },
      },
      a.token,
      400,
    );
    assertEquals(
      bankSummariesPageSchema.parse(
        await call("bank-summaries", { eventId: eventA }, a.token),
      ).items.length,
      1,
    );
    const expired = expireBankTransferOrderResultSchema.parse(
      await call("bank-expire", { orderId: orderIds[0] }, a.token),
    );
    assertEquals(expired.releasedUnits, 1);
    assertEquals(
      expireBankTransferOrderResultSchema.parse(
        await call("bank-expire", { orderId: orderIds[0] }, a.token),
      ).idempotent,
      true,
    );
    adminDeleteOrderResultSchema.parse(
      await call("delete", { orderId: orderIds[2] }, a.token),
    );
    await call("delete", { orderId: orderIds[2] }, a.token, 404);
    // Old RPC and table paths remain denied with actual authenticated tokens and RLS off.
    const rpcArgs: Record<string, object> = {
      search_event_admin_orders_view: { p_event_id: eventA },
      search_event_admin_tickets_view: { p_event_id: eventA },
      get_event_admin_orders_view: { p_event_id: eventA },
      get_event_admin_participants_export_data: { p_event_id: eventA },
      admin_update_order_attendee: {
        p_attendee_id: attendeeIds[0],
        p_attendee: { answers: [] },
      },
      admin_delete_order: { p_order_id: orderIds[3] },
      get_bank_transfer_admin_summaries: { p_event_id: eventA },
      expire_bank_transfer_order: { p_order_id: orderIds[0] },
    };
    for (const [name, args] of Object.entries(rpcArgs)) {
      const r = await a.client.rpc(name, args);
      assert(r.error);
      assert(["42501", "PGRST202"].includes(r.error.code));
    }
    for (
      const table of [
        "orders",
        "order_items",
        "order_attendees",
        "order_attendee_answers",
        "payments",
        "tickets",
      ]
    ) {
      const r = await a.client.from(table).select("id").limit(1);
      assertEquals(r.error?.code, "42501");
    }
    const key = await hashRateLimitKey(
      `user:${a.id}:org:${orgA}`,
      env("RATE_LIMIT_SALT"),
    );
    for (
      const [scope, limit] of [["organizer:read:1m", 240], [
        "organizer:write:1m",
        120,
      ]] as const
    ) {
      for (let n = 0; n < limit; n++) {
        const r = await service.rpc("consume_rate_limit", {
          p_key_hash: key,
          p_scope: scope,
          p_limit: limit,
          p_window_seconds: 60,
        });
        assert(!r.error, `Quota fixture: ${r.error?.code}`);
      }
    }
    for (const f of families) {
      await call(
        f.route,
        f.route === "delete" ? { orderId: orderIds[3] } : f.own,
        a.token,
        429,
      );
    }
    assert(
      (await service.from("orders").select("id").eq("id", orderIds[3]).single())
        .data,
    );
    await call("list", { eventId: eventB }, b.token);
  } finally {
    for (const id of orgs) {
      const r = await service.from("organizations").delete().eq("id", id);
      assert(!r.error);
    }
    for (const id of users) {
      assert(!(await service.auth.admin.deleteUser(id)).error);
    }
    await server.shutdown();
  }
});
