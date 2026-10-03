import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { handleEventsRequest } from "../events/index.ts";

const actor = "b2400000-0000-4000-8000-000000000001";
const foreignActor = "b2400000-0000-4000-8000-000000000002";
const orgA = "b2400000-0000-4000-8000-000000000011";
const orgB = "b2400000-0000-4000-8000-000000000012";
const eventA = "b2400000-0000-4000-8000-000000000021";
const eventB = "b2400000-0000-4000-8000-000000000022";
const promoA = "b2400000-0000-4000-8000-000000000031";
const promoB = "b2400000-0000-4000-8000-000000000032";
const promo = {
  id: promoA,
  org_id: orgA,
  event_id: eventA,
  code: "SUMMER",
  discount_percent: 10,
  discount_cents: null,
  max_uses: null,
  used_count: 0,
  starts_at: null,
  ends_at: null,
  is_active: true,
  created_at: "2026-10-03T12:00:00.000Z",
  updated_at: "2026-10-03T12:00:00.000Z",
};
type Call = { url: URL; headers: Headers; body: unknown };
type Options = {
  authError?: boolean;
  role?: string | null;
  promoAbsent?: boolean;
  eventAbsent?: boolean;
  resourceError?: boolean;
  relationshipMismatch?: boolean;
  emptyList?: boolean;
  usedCount?: number;
  quota?: "denied" | "unavailable";
  malformedOutput?: boolean;
  databaseError?: { message: string; code?: string };
};
async function fixture(
  options: Options,
  run: (calls: Call[]) => Promise<void>,
) {
  const env = {
    SUPABASE_URL: "https://promos-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: "fixture-promos-salt",
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
      assertEquals(request.method, "GET");
      assertEquals(url.searchParams.get("select"), "id,org_id");
      if (options.eventAbsent) return Response.json(null);
      const foreign = url.searchParams.get("id") === `eq.${eventB}`;
      return Response.json({
        id: foreign ? eventB : eventA,
        org_id: foreign ? orgB : orgA,
      });
    }
    if (url.pathname === "/rest/v1/promo_codes") {
      assertEquals(request.method, "GET");
      if (options.resourceError) {
        return Response.json({ message: "private-db-detail" }, { status: 500 });
      }
      if (url.searchParams.get("select") === "id,event_id,org_id") {
        if (options.promoAbsent) return Response.json(null);
        const foreign = url.searchParams.get("id") === `eq.${promoB}`;
        return Response.json({
          id: foreign ? promoB : promoA,
          event_id: foreign ? eventB : eventA,
          org_id: foreign || options.relationshipMismatch ? orgB : orgA,
        });
      }
      assertEquals(url.searchParams.get("org_id"), `eq.${orgA}`);
      assertEquals(url.searchParams.get("event_id"), `eq.${eventA}`);
      assert(!url.searchParams.get("select")?.includes("*"));
      assert(!url.searchParams.get("select")?.includes("private_secret"));
      const output = options.malformedOutput
        ? { id: "private-response-detail" }
        : {
          ...promo,
          used_count: options.usedCount ?? 0,
          private_secret: "never-return",
        };
      if (url.searchParams.has("id")) {
        assertEquals(url.searchParams.get("id"), `eq.${promoA}`);
        return Response.json(output);
      }
      assertEquals(url.searchParams.get("order"), "created_at.desc");
      assertEquals(url.searchParams.get("limit"), "1000");
      return Response.json(options.emptyList ? [] : [output]);
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
      if (url.pathname.endsWith("/organizer_delete_event_promo_code")) {
        assertEquals(args.p_org_id, orgA);
        assertEquals(args.p_event_id, eventA);
        assertEquals(args.p_promo_code_id, promoA);
        return Response.json(
          options.malformedOutput
            ? { success: false, private_secret: "never-return" }
            : { success: true },
        );
      }
      const patch = z.record(z.string(), z.unknown()).parse(args.p_input);
      assertEquals(patch.org_id, orgA);
      assertEquals(patch.event_id, eventA);
      if (url.pathname.endsWith("/organizer_update_event_promo_code")) {
        assertEquals(patch.promo_code_id, promoA);
      }
      return Response.json(
        options.malformedOutput ? { id: "private-response-detail" } : {
          ...promo,
          used_count: options.usedCount ?? 0,
          ...patch,
          private_secret: "never-return",
        },
      );
    }
    throw new Error(`Unexpected promo fixture path ${url.pathname}`);
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
  prefix = "/events/promos/",
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
    (call.url.pathname === "/rest/v1/promo_codes" &&
      call.url.searchParams.get("select") !== "id,event_id,org_id")
  );
}
function quotas(calls: Call[]) {
  return calls.filter((call) =>
    call.url.pathname.endsWith("/consume_rate_limit")
  );
}
const createBody = {
  orgId: orgA,
  eventId: eventA,
  code: "SUMMER",
  discountPercent: 10,
  discountCents: null,
};
const scenarios = [
  { route: "list", body: { eventId: eventA } },
  { route: "create", body: createBody },
  { route: "update", body: { promoCodeId: promoA, patch: { code: "AUTUMN" } } },
  { route: "read", body: { promoCodeId: promoA } },
  { route: "delete", body: { id: promoA } },
];

Deno.test("promos missing or invalid Auth refuses every route before lookup", async () => {
  for (const invalid of [false, true]) {
    await fixture({ authError: invalid }, async (calls) => {
      for (const scenario of scenarios) {
        assertEquals(
          (await handleEventsRequest(
            request(scenario.route, scenario.body, invalid),
          )).status,
          401,
        );
      }
      assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
    });
  }
});

Deno.test("promos create normalizes code defaults and derives actor and scope on service bearer", async () => {
  await fixture({}, async (calls) => {
    const result = await handleEventsRequest(
      request("create", {
        ...createBody,
        orgId: orgA.toUpperCase(),
        eventId: eventA.toUpperCase(),
        code: "  summer  ",
      }),
    );
    assertEquals(result.status, 200);
    const dto = await result.json();
    assertEquals(dto.code, "SUMMER");
    assertEquals(dto.usedCount, 0);
    assertEquals(dto.orgId, orgA);
    assertEquals(dto.eventId, eventA);
    assertEquals(dto.createdAt, promo.created_at);
    assertEquals(dto.updatedAt, promo.updated_at);
    assertEquals(dto.private_secret, undefined);
    assertEquals(dto.used_count, undefined);
    assertEquals(effects(calls)[0].body, {
      p_actor_id: actor,
      p_input: {
        org_id: orgA,
        event_id: eventA,
        code: "SUMMER",
        discount_percent: 10,
        discount_cents: null,
        max_uses: null,
        starts_at: null,
        ends_at: null,
        is_active: true,
      },
    });
    assert(quotas(calls).length > 0);
  });
});

Deno.test("promos list and read project scoped full DTO preserving usage and timestamps", async () => {
  for (const usedCount of [0, 12]) {
    await fixture({ usedCount }, async (calls) => {
      for (const route of ["list", "read"]) {
        const result = await handleEventsRequest(
          request(
            route,
            route === "list" ? { eventId: eventA } : { promoCodeId: promoA },
            true,
            "/functions/v1/events/promos/",
          ),
        );
        assertEquals(result.status, 200);
        const json = await result.json();
        const dto = route === "list" ? json[0] : json;
        assertEquals(dto.usedCount, usedCount);
        assertEquals(dto.discountPercent, 10);
        assertEquals(dto.discountCents, null);
        assertEquals(dto.createdAt, promo.created_at);
        assertEquals(dto.updatedAt, promo.updated_at);
        assertEquals(dto.private_secret, undefined);
        assertEquals(dto.event_id, undefined);
      }
      assertEquals(effects(calls).length, 2);
    });
  }
  await fixture({ emptyList: true }, async () => {
    assertEquals(
      await (await handleEventsRequest(request("list", { eventId: eventA })))
        .json(),
      [],
    );
  });
});

Deno.test("promos update preserves omitted keys nullable clearing and both discount switches", async () => {
  for (
    const patch of [
      { maxUses: null, startsAt: null, endsAt: null },
      { code: " autumn " },
      { isActive: false },
      { discountPercent: null, discountCents: 500 },
      { discountPercent: 25, discountCents: null },
      { startsAt: "2026-10-04T09:00:00+02:00" },
    ]
  ) {
    await fixture({ usedCount: 9 }, async (calls) => {
      const result = await handleEventsRequest(
        request("update", { promoCodeId: promoA, patch }),
      );
      assertEquals(result.status, 200);
      assertEquals((await result.json()).usedCount, 9);
      const args = z.record(z.string(), z.unknown()).parse(
        effects(calls)[0].body,
      );
      const payload = z.record(z.string(), z.unknown()).parse(args.p_input);
      assertEquals(payload, {
        org_id: orgA,
        event_id: eventA,
        promo_code_id: promoA,
        ...Object.fromEntries(
          Object.entries(patch).map((
            [key, value],
          ) => [
            key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
            key === "code" ? "AUTUMN" : value,
          ]),
        ),
      });
      assertEquals(payload.used_count, undefined);
      assertEquals(payload.created_at, undefined);
      assertEquals(payload.updated_at, undefined);
    });
  }
});

Deno.test("promos delete supplies verified actor and derived organization event and resource", async () => {
  await fixture({}, async (calls) => {
    const result = await handleEventsRequest(request("delete", { id: promoA }));
    assertEquals(result.status, 200);
    assertEquals(await result.json(), { success: true });
    assertEquals(effects(calls)[0].body, {
      p_actor_id: actor,
      p_org_id: orgA,
      p_event_id: eventA,
      p_promo_code_id: promoA,
    });
  });
});

Deno.test("promos derive foreign tenant and refuse forged create org before quota or effects", async () => {
  await fixture({}, async (calls) => {
    for (
      const scenario of [
        { route: "list", body: { eventId: eventB } },
        {
          route: "create",
          body: { ...createBody, eventId: eventB, orgId: orgB },
        },
        { route: "create", body: { ...createBody, orgId: orgB } },
        { route: "read", body: { promoCodeId: promoB } },
        {
          route: "update",
          body: { promoCodeId: promoB, patch: { code: "FOREIGN" } },
        },
        { route: "delete", body: { id: promoB } },
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

Deno.test("promos legacy inconsistent org event relation refuses scoped read and writes", async () => {
  await fixture({ relationshipMismatch: true }, async (calls) => {
    for (
      const scenario of scenarios.filter((entry) =>
        ["read", "update", "delete"].includes(entry.route)
      )
    ) {
      const result = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(result.status, 409);
      assertEquals(await result.json(), { error: "RELATIONSHIP_CONFLICT" });
    }
    assertEquals(quotas(calls).length, 0);
    assertEquals(effects(calls).length, 0);
    assert(
      calls.some((call) =>
        call.url.pathname === "/rest/v1/organization_members"
      ),
    );
  });
});

Deno.test("promos owner admin alone can access every route", async () => {
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

Deno.test("promos deny system fields actors ids and tenant reassignment before lookups", async () => {
  await fixture({}, async (calls) => {
    for (
      const [key, value] of Object.entries({
        id: promoB,
        usedCount: 0,
        createdAt: "2026-10-03",
        updatedAt: "2026-10-03",
        userId: foreignActor,
        p_actor_id: foreignActor,
        private_secret: "x",
      })
    ) {
      assertEquals(
        (await handleEventsRequest(
          request("create", { ...createBody, [key]: value }),
        )).status,
        400,
      );
      assertEquals(
        (await handleEventsRequest(
          request("update", {
            promoCodeId: promoA,
            patch: { code: "AUTUMN", [key]: value },
          }),
        )).status,
        400,
      );
    }
    for (const key of ["orgId", "eventId", "promoCodeId"]) {
      assertEquals(
        (await handleEventsRequest(
          request("update", {
            promoCodeId: promoA,
            patch: { code: "AUTUMN", [key]: orgB },
          }),
        )).status,
        400,
      );
    }
    for (
      const scenario of scenarios.filter((entry) => entry.route !== "create")
    ) {
      assertEquals(
        (await handleEventsRequest(
          request(scenario.route, { ...scenario.body, orgId: orgA }),
        )).status,
        400,
      );
    }
    assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
  });
});

Deno.test("promos reject malformed discount dates bounds nulls and empty patch before lookups", async () => {
  await fixture({}, async (calls) => {
    for (
      const patch of [
        { code: "  " },
        { code: "x".repeat(21) },
        { code: null },
        { discountPercent: null, discountCents: null },
        { discountPercent: 10, discountCents: 500 },
        { discountPercent: 0, discountCents: null },
        { discountPercent: 101, discountCents: null },
        { discountPercent: 10.5, discountCents: null },
        { discountPercent: null, discountCents: 0 },
        { discountPercent: null, discountCents: 100001 },
        { discountPercent: null, discountCents: 0.5 },
        { maxUses: 0 },
        { maxUses: 100000 },
        { maxUses: 1.5 },
        { isActive: null },
        { startsAt: "not-a-date" },
        { endsAt: "2026-10-04" },
        { startsAt: "2026-10-04T12:00:00Z", endsAt: "2026-10-04T12:00:00Z" },
        { startsAt: "2026-10-05T12:00:00Z", endsAt: "2026-10-04T12:00:00Z" },
      ]
    ) {
      assertEquals(
        (await handleEventsRequest(
          request("create", { ...createBody, ...patch }),
        )).status,
        400,
      );
      assertEquals(
        (await handleEventsRequest(
          request("update", { promoCodeId: promoA, patch }),
        )).status,
        400,
      );
    }
    for (
      const patch of [{}, { discountPercent: 20 }, { discountCents: null }]
    ) {
      assertEquals(
        (await handleEventsRequest(
          request("update", { promoCodeId: promoA, patch }),
        )).status,
        400,
      );
    }
    assertEquals(
      (await handleEventsRequest(request("read", { promoCodeId: "bad-id" })))
        .status,
      400,
    );
    assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
  });
});

Deno.test("promos quota exhaustion and unavailable limiter block every business effect after membership", async () => {
  for (const quota of ["denied", "unavailable"] as const) {
    await fixture({ quota }, async (calls) => {
      for (const scenario of scenarios) {
        const start = calls.length;
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
        const requestCalls = calls.slice(start);
        const quotaIndex = requestCalls.findIndex((call) =>
          call.url.pathname.endsWith("/consume_rate_limit")
        );
        assert(quotaIndex > 0);
        assert(
          requestCalls.slice(0, quotaIndex).some((call) =>
            call.url.pathname === "/rest/v1/organization_members"
          ),
        );
      }
      assertEquals(effects(calls).length, 0);
    });
  }
});

Deno.test("promos missing resources or failed lookup stay safe before quota", async () => {
  for (
    const options of [{ promoAbsent: true }, { eventAbsent: true }, {
      resourceError: true,
    }]
  ) {
    await fixture(options, async (calls) => {
      const result = await handleEventsRequest(
        request("read", { promoCodeId: promoA }),
      );
      assertEquals(result.status, options.resourceError ? 500 : 404);
      assertEquals(
        (await result.json()).error,
        options.resourceError ? "PROMO_LOAD_FAILED" : "NOT_FOUND",
      );
      assertEquals(quotas(calls).length, 0);
      assertEquals(effects(calls).length, 0);
    });
  }
});

Deno.test("promos malformed JSON and inclusive 16384 byte body cap precede business calls", async () => {
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

Deno.test("promos malformed output is a safe server error on all five routes", async () => {
  await fixture({ malformedOutput: true }, async () => {
    for (const scenario of scenarios) {
      const result = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(result.status, 500);
      assertEquals(await result.json(), { error: "UNEXPECTED_ERROR" });
    }
  });
});

Deno.test("promos SQL errors expose stable safe duplicate FK validation and failure codes", async () => {
  for (
    const [databaseError, status, code] of [
      [
        { message: "DUPLICATE_PROMO_CODE: private unique value" },
        409,
        "DUPLICATE_PROMO_CODE",
      ],
      [{ message: "private unique detail", code: "23505" }, 409, "CONFLICT"],
      [
        { message: "private FK details", code: "23503" },
        409,
        "RESOURCE_IN_USE",
      ],
      [
        { message: "RELATIONSHIP_CONFLICT: private relation" },
        409,
        "RELATIONSHIP_CONFLICT",
      ],
      [{ message: "VALIDATION_ERROR: private dates" }, 400, "VALIDATION_ERROR"],
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
        request("delete", { id: promoA }),
      );
      assertEquals(result.status, status);
      assertEquals(await result.json(), { error: code });
      if (status === 429) assertEquals(result.headers.get("retry-after"), "60");
    });
  }
});

Deno.test("promos route lookalikes refuse without lookup or business effects", async () => {
  await fixture({}, async (calls) => {
    assertEquals(
      (await handleEventsRequest(
        request("read-extra", { promoCodeId: promoA }),
      )).status,
      404,
    );
    assertEquals(
      (await handleEventsRequest(
        request("read", { promoCodeId: promoA }, true, "/events-extra/promos/"),
      )).status,
      404,
    );
    assertEquals(effects(calls).length, 0);
    assertEquals(quotas(calls).length, 0);
  });
});
