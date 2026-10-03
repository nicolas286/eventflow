import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleOrdersRequest } from "../../supabase/functions/orders/index.ts";
import { hashRateLimitKey } from "../../supabase/functions/_shared/modules/supabase-rate-limit/hash-key.ts";
import {
  getEventTicketsAdminResponseSchema,
  ticketCheckInResponseSchema,
} from "../../shared/schemas/ticket-check-in.ts";
function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing synthetic ${name}`);
  return value;
}
Deno.test("B4 real Auth/HTTP/PostgREST without RLS: list, ID/QR scan, scope, contracts, quota and closure", async () => {
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
    const email = `b4-${crypto.randomUUID()}@example.test`,
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
      eventB = crypto.randomUUID();
    const product = crypto.randomUUID(),
      order = crypto.randomUUID(),
      item = crypto.randomUUID(),
      ticket = crypto.randomUUID(),
      untouched = crypto.randomUUID();
    orgs.push(orgA, orgB);
    await insert("organizations", [{
      id: orgA,
      type: "association",
      name: "B4 A",
      plan: "pro",
    }, { id: orgB, type: "association", name: "B4 B", plan: "pro" }]);
    await insert("organization_members", [
      { org_id: orgA, user_id: a.id, role: "owner" },
      { org_id: orgA, user_id: admin.id, role: "admin" },
      { org_id: orgB, user_id: b.id, role: "owner" },
    ]);
    await insert("events", [{
      id: eventA,
      org_id: orgA,
      slug: "b4-a",
      title: "B4 A",
    }, { id: eventB, org_id: orgB, slug: "b4-b", title: "B4 B" }]);
    await insert("event_products", [{
      id: product,
      event_id: eventA,
      name: "B4 Ticket",
      price_cents: 100,
    }]);
    await insert("orders", [{
      id: order,
      org_id: orgA,
      event_id: eventA,
      currency: "EUR",
      total_cents: 200,
      paid_cents: 200,
      status: "paid",
      booking_token: crypto.randomUUID(),
      buyer_email: "synthetic@example.test",
    }]);
    await insert("order_items", [{
      id: item,
      order_id: order,
      product_id: product,
      product_name_snapshot: "B4 Ticket",
      unit_price_cents_snapshot: 100,
      quantity: 2,
    }]);
    await insert("tickets", [{
      id: ticket,
      order_id: order,
      order_item_id: item,
      event_id: eventA,
      product_id: product,
      ticket_index: 1,
      qr_token: "B4-HTTP-ticket",
      status: "valid",
    }, {
      id: untouched,
      order_id: order,
      order_item_id: item,
      event_id: eventA,
      product_id: product,
      ticket_index: 2,
      qr_token: "B4-HTTP-untouched",
      status: "valid",
    }]);
    const families = [{ route: "tickets-list", body: { eventId: eventA } }, {
      route: "ticket-check-in",
      body: { eventId: eventA, ticketId: ticket },
    }, {
      route: "ticket-check-in-qr",
      body: { eventId: eventA, qrToken: "B4-HTTP-ticket" },
    }];
    for (const f of families) {
      await call(f.route, f.body, null, 401);
      await call(f.route, f.body, "invalid", 401);
      await call(f.route, f.body, b.token, 403);
      await call(f.route, { ...f.body, orgId: orgB }, a.token, 403);
      await call(f.route, { ...f.body, eventId: eventB }, a.token, 403);
      await call(f.route, { ...f.body, checkedInBy: b.id }, a.token, 400);
    }
    await call(
      "ticket-check-in",
      { eventId: eventB, ticketId: ticket },
      b.token,
      409,
    );
    await call(
      "ticket-check-in-qr",
      { eventId: eventB, qrToken: "B4-HTTP-ticket" },
      b.token,
      404,
    );
    const listed = getEventTicketsAdminResponseSchema.parse(
      await call("tickets-list", { eventId: eventA, limit: 1 }, a.token),
    );
    assertEquals(listed.tickets.total, 2);
    assertEquals(listed.tickets.rows.length, 1);
    await call("tickets-list", { eventId: eventA, limit: 1001 }, a.token, 400);
    await call(
      "ticket-check-in-qr",
      { eventId: eventA, qrToken: "forged" },
      a.token,
      404,
    );
    await call(
      "ticket-check-in-qr",
      { eventId: eventA, qrToken: "x".repeat(2049) },
      a.token,
      400,
    );
    await call(
      "ticket-check-in",
      { eventId: eventA, ticketId: crypto.randomUUID() },
      a.token,
      404,
    );
    const first = ticketCheckInResponseSchema.parse(
      await call(
        "ticket-check-in",
        { eventId: eventA, ticketId: ticket },
        a.token,
      ),
    );
    assertEquals(first.outcome, "validated");
    assertEquals(first.checkedInBy, a.id);
    const repeat = ticketCheckInResponseSchema.parse(
      await call("ticket-check-in-qr", {
        eventId: eventA,
        qrToken: " B4-HTTP-ticket ",
      }, admin.token),
    );
    assertEquals(repeat.outcome, "already_checked");
    assertEquals(repeat.checkedInBy, a.id);
    assertEquals(repeat.checkedInAt, first.checkedInAt);
    assert(
      !(await service.from("tickets").update({ status: "cancelled" }).eq(
        "id",
        untouched,
      )).error,
    );
    await call(
      "ticket-check-in",
      { eventId: eventA, ticketId: untouched },
      a.token,
      409,
    );
    assert(
      !(await service.from("tickets").update({ status: "valid" }).eq(
        "id",
        untouched,
      )).error,
    );
    for (
      const [name, args] of [
        ["get_event_tickets_admin", { p_event_id: eventA }],
        ["mark_ticket_checked_in", { p_ticket_id: ticket, p_event_id: eventA }],
        ["mark_ticket_checked_in_by_qr", {
          p_qr_token: "B4-HTTP-ticket",
          p_event_id: eventA,
        }],
      ] as const
    ) assertEquals((await a.client.rpc(name, args)).error?.code, "42501");
    assertEquals(
      (await a.client.from("tickets").select("id")).error?.code,
      "42501",
    );
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
        assert(
          !(await service.rpc("consume_rate_limit", {
            p_key_hash: key,
            p_scope: scope,
            p_limit: limit,
            p_window_seconds: 60,
          })).error,
        );
      }
    }
    for (const f of families) {
      await call(
        f.route,
        f.route === "ticket-check-in"
          ? { eventId: eventA, ticketId: untouched }
          : f.route === "ticket-check-in-qr"
          ? { eventId: eventA, qrToken: "B4-HTTP-untouched" }
          : f.body,
        a.token,
        429,
      );
    }
    assertEquals(
      (await service.from("tickets").select("checked_in_at").eq("id", untouched)
        .single()).data?.checked_in_at,
      null,
    );
    getEventTicketsAdminResponseSchema.parse(
      await call("tickets-list", { eventId: eventB }, b.token),
    );
  } finally {
    for (const id of orgs) {
      assert(
        !(await service.from("organizations").delete().eq("id", id)).error,
      );
    }
    for (const id of users) {
      assert(!(await service.auth.admin.deleteUser(id)).error);
    }
    await server.shutdown();
  }
});
