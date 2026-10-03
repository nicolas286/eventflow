import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { handleEventsRequest } from "../events/index.ts";

const actor = "b2200000-0000-4000-8000-000000000001";
const foreignActor = "b2200000-0000-4000-8000-000000000002";
const orgA = "b2200000-0000-4000-8000-000000000011";
const orgB = "b2200000-0000-4000-8000-000000000012";
const eventA = "b2200000-0000-4000-8000-000000000021";
const eventB = "b2200000-0000-4000-8000-000000000022";
const productA = "b2200000-0000-4000-8000-000000000031";
const productB = "b2200000-0000-4000-8000-000000000032";
const product = {
  id: productA,
  event_id: eventA,
  name: "Fixture Product",
  description: null,
  price_cents: 1000,
  currency: "EUR",
  stock_qty: 0,
  reserved_qty: 0,
  sold_qty: 0,
  is_active: true,
  sort_order: 1,
  creates_attendees: true,
  attendees_per_unit: 1,
  is_gatekeeper: false,
  close_event_when_sold_out: false,
  created_at: "2026-10-03T12:00:00.000Z",
  updated_at: "2026-10-03T12:00:00.000Z",
};
type Call = { url: URL; headers: Headers; body: unknown };
type Options = {
  authError?: boolean;
  role?: string | null;
  productAbsent?: boolean;
  eventAbsent?: boolean;
  resourceError?: boolean;
  quota?: "denied" | "unavailable";
  malformedOutput?: boolean;
  databaseError?: { message: string; code?: string };
};
async function fixture(
  options: Options,
  run: (calls: Call[]) => Promise<void>,
) {
  const env = {
    SUPABASE_URL: "https://products-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: "fixture-products-salt",
  };
  const oldEnv = new Map(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  const oldFetch = globalThis.fetch;
  const calls: Call[] = [];
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const raw = await request.text();
    const body: unknown = raw ? JSON.parse(raw) : null;
    calls.push({ url, headers: request.headers, body });
    if (url.pathname === "/auth/v1/user") {
      assertEquals(request.headers.get("authorization"), "Bearer fixture-user");
      return options.authError
        ? Response.json({ message: "Invalid JWT" }, { status: 401 })
        : Response.json({
          id: actor,
          user_metadata: { userId: foreignActor, orgId: orgB, role: "owner" },
        });
    }
    assertEquals(
      request.headers.get("authorization"),
      "Bearer fixture-service",
    );
    assertEquals(request.headers.get("apikey"), "fixture-service");
    if (url.pathname === "/rest/v1/organization_members") {
      assertEquals(url.searchParams.get("select"), "role");
      assertEquals(url.searchParams.get("user_id"), `eq.${actor}`);
      return Response.json(
        url.searchParams.get("org_id") === `eq.${orgA}` && options.role !== null
          ? { role: options.role ?? "admin" }
          : null,
      );
    }
    if (url.pathname === "/rest/v1/events") {
      assertEquals(url.searchParams.get("select"), "id,org_id");
      assertEquals(request.method, "GET");
      if (options.eventAbsent) return Response.json(null);
      const foreign = url.searchParams.get("id") === `eq.${eventB}`;
      return Response.json({
        id: foreign ? eventB : eventA,
        org_id: foreign ? orgB : orgA,
      });
    }
    if (url.pathname === "/rest/v1/event_products") {
      assertEquals(request.method, "GET");
      if (options.resourceError) {
        return Response.json({ message: "private-db-detail" }, { status: 500 });
      }
      if (options.productAbsent) return Response.json(null);
      if (url.searchParams.get("select") === "id,event_id") {
        const foreign = url.searchParams.get("id") === `eq.${productB}`;
        return Response.json({
          id: foreign ? productB : productA,
          event_id: foreign ? eventB : eventA,
        });
      }
      assertEquals(url.searchParams.get("id"), `eq.${productA}`);
      assertEquals(url.searchParams.get("event_id"), `eq.${eventA}`);
      assert(!url.searchParams.get("select")?.includes("*"));
      assert(!url.searchParams.get("select")?.includes("private_secret"));
      return Response.json(
        options.malformedOutput
          ? { id: "private-response-detail" }
          : { ...product, private_secret: "never-return" },
      );
    }
    if (url.pathname.endsWith("/consume_rate_limit")) {
      if (options.quota === "unavailable") {
        return Response.json({ message: "private-quota-detail" }, {
          status: 500,
        });
      }
      return Response.json([{
        allowed: options.quota !== "denied",
        request_count: 1,
        retry_after_seconds: options.quota === "denied" ? 17 : 0,
      }]);
    }
    if (url.pathname.startsWith("/rest/v1/rpc/organizer_")) {
      const args = z.record(z.string(), z.unknown()).parse(body);
      assertEquals(args.p_actor_id, actor);
      if (options.databaseError) {
        return Response.json(options.databaseError, { status: 400 });
      }
      if (url.pathname.endsWith("/organizer_delete_event_product")) {
        assertEquals(args.p_org_id, orgA);
        assertEquals(args.p_event_id, eventA);
        assertEquals(args.p_product_id, productA);
        return Response.json(
          options.malformedOutput
            ? { success: false, private_secret: "private-response-detail" }
            : { success: true },
        );
      }
      const patch = z.record(z.string(), z.unknown()).parse(args.p_input);
      assertEquals(patch.org_id, orgA);
      assertEquals(patch.event_id, eventA);
      if (url.pathname.endsWith("/organizer_update_event_product")) {
        assertEquals(patch.product_id, productA);
      }
      return Response.json(
        options.malformedOutput
          ? { id: "private-response-detail" }
          : { ...product, ...patch, private_secret: "never-return" },
      );
    }
    throw new Error(`Unexpected product fixture path ${url.pathname}`);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of oldEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}
function rawRequest(
  route: string,
  body: string,
  auth = true,
  prefix = "/events/products/",
) {
  return new Request(`https://edge.test${prefix}${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer fixture-user" } : {}),
    },
    body,
  });
}
function request(route: string, body: unknown, auth = true, prefix?: string) {
  return rawRequest(route, JSON.stringify(body), auth, prefix);
}
function effects(calls: Call[]) {
  return calls.filter((call) =>
    call.url.pathname.startsWith("/rest/v1/rpc/organizer_") ||
    (call.url.pathname === "/rest/v1/event_products" &&
      call.url.searchParams.get("select") !== "id,event_id")
  );
}
function quotas(calls: Call[]) {
  return calls.filter((call) =>
    call.url.pathname.endsWith("/consume_rate_limit")
  );
}
const scenarios = [
  {
    route: "create",
    body: { eventId: eventA, name: "Fixture Product", priceCents: 1000 },
  },
  {
    route: "update",
    body: { productId: productA, patch: { name: "New Name" } },
  },
  { route: "read", body: { productId: productA } },
  { route: "delete", body: { id: productA } },
];

Deno.test("products missing or invalid Auth refuses every route before any lookup", async () => {
  for (const invalid of [false, true]) {
    await fixture({ authError: invalid }, async (calls) => {
      for (const scenario of scenarios) {
        const result = await handleEventsRequest(
          request(scenario.route, scenario.body, invalid),
        );
        assertEquals(result.status, 401);
      }
      assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
    });
  }
});

Deno.test("products create supplies participant defaults and normalizes EUR with verified actor", async () => {
  await fixture({}, async (calls) => {
    const result = await handleEventsRequest(
      request("create", {
        eventId: eventA,
        name: "  Fixture Product  ",
        priceCents: 1000,
        currency: " eur ",
      }),
    );
    assertEquals(result.status, 200);
    const dto = await result.json();
    assertEquals(dto.name, "Fixture Product");
    assertEquals(dto.stockQty, null);
    assertEquals(dto.createsAttendees, true);
    assertEquals(dto.attendeesPerUnit, 1);
    assertEquals(dto.currency, "EUR");
    assertEquals(dto.private_secret, undefined);
    assertEquals(dto.orgId, undefined);
    const call = effects(calls)[0];
    assertEquals(call.body, {
      p_actor_id: actor,
      p_input: {
        event_id: eventA,
        org_id: orgA,
        name: "Fixture Product",
        price_cents: 1000,
        currency: "EUR",
        description: null,
        stock_qty: null,
        is_active: true,
        sort_order: 1,
        creates_attendees: true,
        attendees_per_unit: 1,
        is_gatekeeper: false,
        close_event_when_sold_out: false,
      },
    });
    assert(quotas(calls).length > 0);
  });
});

Deno.test("products finite stock zero survives create and read DTO mapping", async () => {
  await fixture({}, async (calls) => {
    const created = await handleEventsRequest(
      request("create", {
        eventId: eventA,
        name: "Zero Stock",
        priceCents: 0,
        stockQty: 0,
      }),
    );
    assertEquals(created.status, 200);
    assertEquals((await created.json()).stockQty, 0);
    const read = await handleEventsRequest(
      request(
        "read",
        { productId: productA },
        true,
        "/functions/v1/events/products/",
      ),
    );
    assertEquals(read.status, 200);
    const dto = await read.json();
    assertEquals(dto.stockQty, 0);
    assertEquals(dto.eventId, eventA);
    assertEquals(dto.reservedQty, 0);
    assertEquals(dto.soldQty, 0);
    assertEquals(dto.event_id, undefined);
    assertEquals(dto.private_secret, undefined);
    assertEquals(effects(calls).length, 2);
  });
});

Deno.test("products update preserves omitted fields and explicit nullable fields", async () => {
  for (
    const patch of [{ stockQty: null, description: null }, { stockQty: 0 }, {
      currency: "eur",
      createsAttendees: false,
    }]
  ) {
    await fixture({}, async (calls) => {
      const result = await handleEventsRequest(
        request("update", { productId: productA, patch }),
      );
      assertEquals(result.status, 200);
      const args = z.record(z.string(), z.unknown()).parse(
        effects(calls)[0].body,
      );
      const payload = z.record(z.string(), z.unknown()).parse(args.p_input);
      assertEquals(payload, {
        org_id: orgA,
        event_id: eventA,
        product_id: productA,
        ...Object.fromEntries(
          Object.entries(patch).map((
            [key, value],
          ) => [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            key === "currency" ? "EUR" : value,
          ]),
        ),
      });
      assertEquals(payload.price_cents, undefined);
      assertEquals(payload.reserved_qty, undefined);
    });
  }
});

Deno.test("products deletion uses actor and all derived scope ids with controlled response", async () => {
  await fixture({}, async (calls) => {
    const result = await handleEventsRequest(
      request("delete", { id: productA }),
    );
    assertEquals(result.status, 200);
    assertEquals(await result.json(), { success: true });
    assertEquals(effects(calls)[0].body, {
      p_actor_id: actor,
      p_org_id: orgA,
      p_event_id: eventA,
      p_product_id: productA,
    });
  });
});

Deno.test("products derive foreign organization before authorization and refuse before quota", async () => {
  await fixture({}, async (calls) => {
    for (
      const scenario of [
        {
          route: "create",
          body: { eventId: eventB, name: "Foreign Product", priceCents: 0 },
        },
        { route: "read", body: { productId: productB } },
        {
          route: "update",
          body: { productId: productB, patch: { name: "Foreign Product" } },
        },
        { route: "delete", body: { id: productB } },
      ]
    ) {
      assertEquals(
        (await handleEventsRequest(request(scenario.route, scenario.body)))
          .status,
        403,
      );
    }
    assertEquals(quotas(calls).length, 0);
    assertEquals(effects(calls).length, 0);
    assert(
      calls.some((call) =>
        call.url.searchParams.get("org_id") === `eq.${orgB}`
      ),
    );
  });
});

Deno.test("products allow owner admin and reject missing or insufficient membership on all routes", async () => {
  for (const role of [null, "member", "viewer", "owner", "admin"]) {
    await fixture({ role }, async (calls) => {
      const allowed = role === "owner" || role === "admin";
      for (const scenario of scenarios) {
        assertEquals(
          (await handleEventsRequest(request(scenario.route, scenario.body)))
            .status,
          allowed ? 200 : 403,
        );
      }
      if (!allowed) {
        assertEquals(quotas(calls).length, 0);
        assertEquals(effects(calls).length, 0);
      }
    });
  }
});

Deno.test("products reject system actor org and event reassignment fields before lookups", async () => {
  const fields = {
    id: productB,
    reservedQty: 0,
    soldQty: 0,
    createdAt: "2026-10-03",
    updatedAt: "2026-10-03",
    orgId: orgB,
    userId: foreignActor,
    p_actor_id: foreignActor,
    unknown: true,
  };
  await fixture({}, async (calls) => {
    for (const [key, value] of Object.entries(fields)) {
      assertEquals(
        (await handleEventsRequest(
          request("create", { ...scenarios[0].body, [key]: value }),
        )).status,
        400,
      );
      assertEquals(
        (await handleEventsRequest(
          request("update", {
            productId: productA,
            patch: { name: "Updated Product", [key]: value },
          }),
        )).status,
        400,
      );
    }
    assertEquals(
      (await handleEventsRequest(
        request("update", { productId: productA, patch: { eventId: eventB } }),
      )).status,
      400,
    );
    assertEquals(
      (await handleEventsRequest(
        request("update", {
          productId: productA,
          orgId: orgA,
          patch: { name: "Updated Product" },
        }),
      )).status,
      400,
    );
    assertEquals(
      (await handleEventsRequest(
        request("read", { productId: productA, eventId: eventB }),
      )).status,
      400,
    );
    assertEquals(
      (await handleEventsRequest(
        request("delete", { id: productA, orgId: orgA }),
      )).status,
      400,
    );
    assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
  });
});

Deno.test("products malformed business values and empty patch fail before resource lookup", async () => {
  await fixture({}, async (calls) => {
    for (
      const patch of [
        { name: "  " },
        { name: "x" },
        { priceCents: -1 },
        { priceCents: 0.5 },
        { currency: "USD" },
        { stockQty: -1 },
        { stockQty: 0.5 },
        { stockQty: 1000001 },
        { attendeesPerUnit: 0 },
        { attendeesPerUnit: 21 },
        { isActive: null },
      ]
    ) {
      assertEquals(
        (await handleEventsRequest(
          request("create", { ...scenarios[0].body, ...patch }),
        )).status,
        400,
      );
      assertEquals(
        (await handleEventsRequest(
          request("update", { productId: productA, patch }),
        )).status,
        400,
      );
    }
    assertEquals(
      (await handleEventsRequest(
        request("update", { productId: productA, patch: {} }),
      )).status,
      400,
    );
    assertEquals(
      (await handleEventsRequest(request("read", { productId: "invalid" })))
        .status,
      400,
    );
    assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
  });
});

Deno.test("products quota exhaustion or failure blocks all effects after membership", async () => {
  for (const quota of ["denied", "unavailable"] as const) {
    await fixture({ quota }, async (calls) => {
      for (const scenario of scenarios) {
        const result = await handleEventsRequest(
          request(scenario.route, scenario.body),
        );
        assertEquals(result.status, quota === "denied" ? 429 : 503);
        assertEquals(
          (await result.json()).error,
          quota === "denied" ? "TOO_MANY_REQUESTS" : "RATE_LIMIT_UNAVAILABLE",
        );
        if (quota === "denied") {
          assertEquals(result.headers.get("retry-after"), "17");
        }
      }
      assertEquals(effects(calls).length, 0);
      for (let i = 0; i < calls.length; i++) {
        if (calls[i].url.pathname.endsWith("/consume_rate_limit")) {
          assert(
            calls.slice(0, i).some((call) =>
              call.url.pathname === "/rest/v1/organization_members"
            ),
          );
        }
      }
    });
  }
});

Deno.test("products missing resources and lookup errors remain safe before quota", async () => {
  for (
    const options of [{ productAbsent: true }, { eventAbsent: true }, {
      resourceError: true,
    }]
  ) {
    await fixture(options, async (calls) => {
      const result = await handleEventsRequest(
        request("read", { productId: productA }),
      );
      assertEquals(result.status, options.resourceError ? 500 : 404);
      assertEquals(
        (await result.json()).error,
        options.resourceError ? "PRODUCT_LOAD_FAILED" : "NOT_FOUND",
      );
      assertEquals(quotas(calls).length, 0);
      assertEquals(effects(calls).length, 0);
    });
  }
});

Deno.test("products malformed JSON and inclusive 16384 byte limit precede business calls", async () => {
  await fixture({}, async (calls) => {
    assertEquals(
      (await handleEventsRequest(rawRequest("create", "{"))).status,
      400,
    );
    assertEquals(
      (await handleEventsRequest(rawRequest("create", " ".repeat(16385))))
        .status,
      413,
    );
    assertEquals(
      (await handleEventsRequest(rawRequest("create", " ".repeat(16384))))
        .status,
      400,
    );
    assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
  });
});

Deno.test("products malformed output is a safe server error on read and mutations", async () => {
  await fixture({ malformedOutput: true }, async () => {
    for (
      const scenario of scenarios
    ) {
      const result = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(result.status, 500);
      assertEquals(await result.json(), { error: "UNEXPECTED_ERROR" });
    }
  });
});

Deno.test("products SQL failures expose stable safe conflict and validation codes", async () => {
  for (
    const [databaseError, status, code] of [
      [
        { message: "private FK details", code: "23503" },
        409,
        "RESOURCE_IN_USE",
      ],
      [
        { message: "STOCK_BELOW_ALLOCATED: private allocation" },
        409,
        "STOCK_BELOW_ALLOCATED",
      ],
      [{ message: "PLAN_LIMIT: private plan" }, 409, "PLAN_LIMIT"],
      [{ message: "VALIDATION_ERROR: private input" }, 400, "VALIDATION_ERROR"],
      [
        { message: "private CHECK details", code: "23514" },
        400,
        "VALIDATION_ERROR",
      ],
      [{ message: "private SQL detail" }, 500, "ORGANIZER_OPERATION_FAILED"],
      [{ message: "RATE_LIMITED: private limit" }, 429, "TOO_MANY_REQUESTS"],
    ] as const
  ) {
    await fixture({ databaseError }, async () => {
      const result = await handleEventsRequest(
        request("delete", { id: productA }),
      );
      assertEquals(result.status, status);
      assertEquals(await result.json(), { error: code });
      if (status === 429) assertEquals(result.headers.get("retry-after"), "60");
    });
  }
});

Deno.test("products path lookalikes refuse without lookup or business effects", async () => {
  await fixture({}, async (calls) => {
    assertEquals(
      (await handleEventsRequest(
        request("read-extra", { productId: productA }),
      )).status,
      404,
    );
    assertEquals(
      (await handleEventsRequest(
        request(
          "read",
          { productId: productA },
          true,
          "/events-extra/products/",
        ),
      )).status,
      404,
    );
    assertEquals(effects(calls).length, 0);
    assertEquals(quotas(calls).length, 0);
  });
});
