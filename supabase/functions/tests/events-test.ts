import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { handleEventsRequest } from "../events/index.ts";

const actorId = "b2100000-0000-4000-8000-000000000001";
const foreignActor = "b2100000-0000-4000-8000-000000000002";
const orgA = "b2100000-0000-4000-8000-000000000011";
const orgB = "b2100000-0000-4000-8000-000000000012";
const eventA = "b2100000-0000-4000-8000-000000000021";
const eventB = "b2100000-0000-4000-8000-000000000022";
const clonedEvent = "b2100000-0000-4000-8000-000000000023";
const timestamp = "2026-10-03T12:00:00.000Z";
const event = {
  id: eventA,
  orgId: orgA,
  slug: "fixture-event",
  title: "Fixture Event",
  description: "Fixture description",
  location: "Namur",
  bannerUrl: null,
  startsAt: "2027-12-01T12:00:00.000Z",
  endsAt: "2027-12-01T14:00:00.000Z",
  registrationDeadline: "2027-12-01T11:00:00.000Z",
  isPublished: false,
  maxAttendees: 50,
  depositCents: 0,
  charterText: "Fixture Charter",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const createInput = {
  orgId: orgA,
  title: event.title,
  description: event.description,
  location: event.location,
  bannerUrl: null,
  startsAt: event.startsAt,
  endsAt: event.endsAt,
  registrationDeadline: event.registrationDeadline,
  maxAttendees: event.maxAttendees,
  depositCents: 0,
  charterText: event.charterText,
};
const optionsJson = [{
  label: "snake_label unchanged",
  value: "RAW_Value_unchanged",
}];
const product = {
  id: "b2100000-0000-4000-8000-000000000031",
  event_id: eventA,
  name: "Fixture Product",
  description: null,
  price_cents: 0,
  currency: "EUR",
  stock_qty: 0,
  is_active: true,
  sort_order: 1,
  creates_attendees: true,
  attendees_per_unit: 1,
  reserved_qty: 0,
  sold_qty: 0,
  is_gatekeeper: false,
  close_event_when_sold_out: false,
  created_at: timestamp,
  updated_at: timestamp,
};
const field = {
  id: "b2100000-0000-4000-8000-000000000041",
  event_id: eventA,
  group_id: "b2100000-0000-4000-8000-000000000051",
  label: "Fixture Choice",
  field_key: "snake_key",
  field_type: "select",
  is_required: true,
  options: optionsJson,
  sort_order: 1,
  is_active: true,
  created_at: timestamp,
  updated_at: timestamp,
};
const group = {
  id: "b2100000-0000-4000-8000-000000000051",
  event_id: eventA,
  label: "Fixture Group",
  description: null,
  sort_order: 1,
  is_active: true,
  created_at: timestamp,
  updated_at: timestamp,
};
type Call = { url: URL; headers: Headers; body: unknown; method: string };
type Options = {
  authError?: boolean;
  role?: string | null;
  quota?: "denied" | "unavailable";
  resourceAbsent?: boolean;
  resourceError?: boolean;
  invalidResponse?: boolean;
  databaseError?: { message: string; code?: string };
};
async function withFixture(
  options: Options,
  run: (calls: Call[]) => Promise<void>,
) {
  const env = {
    SUPABASE_URL: "https://events-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: "fixture-events-salt",
  };
  const oldEnv = new Map(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  const oldFetch = globalThis.fetch;
  const calls: Call[] = [];
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  globalThis.fetch = async (input, init) => {
    const outbound = new Request(input, init);
    const url = new URL(outbound.url);
    const text = await outbound.text();
    const body: unknown = text ? JSON.parse(text) : null;
    calls.push({
      url,
      headers: outbound.headers,
      body,
      method: outbound.method,
    });
    if (url.pathname === "/auth/v1/user") {
      assertEquals(
        outbound.headers.get("authorization"),
        "Bearer fixture-user",
      );
      if (options.authError) {
        return Response.json({ code: "bad_jwt", message: "Invalid JWT" }, {
          status: 401,
        });
      }
      return Response.json({
        id: actorId,
        email: "fixture@example.test",
        user_metadata: { userId: foreignActor, orgId: orgB, role: "owner" },
      });
    }
    assertEquals(
      outbound.headers.get("authorization"),
      "Bearer fixture-service",
    );
    assertEquals(outbound.headers.get("apikey"), "fixture-service");
    if (url.pathname === "/rest/v1/organization_members") {
      assertEquals(url.searchParams.get("user_id"), `eq.${actorId}`);
      assertEquals(url.searchParams.get("select"), "role");
      assert(url.searchParams.has("org_id"));
      return Response.json(
        url.searchParams.get("org_id") === `eq.${orgA}` && options.role !== null
          ? { role: options.role ?? "admin" }
          : null,
      );
    }
    if (url.pathname === "/rest/v1/events") {
      assertEquals(outbound.method, "GET");
      assertEquals(url.searchParams.get("select"), "id,org_id");
      const id = url.searchParams.get("id");
      const org = url.searchParams.get("org_id");
      assert(id || (org && url.searchParams.get("slug")));
      if (options.resourceError) {
        return Response.json({ message: "private-resource-error" }, {
          status: 500,
        });
      }
      if (options.resourceAbsent) return Response.json(null);
      const foreign = id === `eq.${eventB}` || org === `eq.${orgB}`;
      return Response.json({
        id: foreign ? eventB : eventA,
        org_id: foreign ? orgB : orgA,
      });
    }
    if (url.pathname.endsWith("/consume_rate_limit")) {
      if (options.quota === "unavailable") {
        return Response.json({ message: "private-rate-detail" }, {
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
      if (options.databaseError) {
        return Response.json(options.databaseError, { status: 400 });
      }
      const args = z.record(z.string(), z.unknown()).parse(body);
      if (options.invalidResponse) {
        return Response.json({ id: "private-response-error" });
      }
      if (url.pathname.endsWith("/organizer_get_events_overview")) {
        assertEquals(args.p_org_id, orgA);
        return Response.json({
          orgId: orgA,
          events: [{
            event: {
              ...Object.fromEntries(
                Object.entries(event).map(([key, value]) => [
                  key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
                  value,
                ]),
              ),
              secret: "never-return",
            },
            ordersCount: 2,
            paidCents: 500,
          }],
          secret: "never-return",
        });
      }
      if (url.pathname.endsWith("/organizer_get_event_detail_admin_core")) {
        assertEquals(args.p_org_id, orgA);
        assertEquals(args.p_event_id, eventA);
        assertEquals(args.p_event_slug, null);
        return Response.json({
          event: {
            ...event,
            bannerUrlRaw: null,
            bannerUrlEffective: "https://events-fixture.supabase.co/banner.png",
            secret: "never-return",
          },
          orgBranding: {
            logoUrl: "https://events-fixture.supabase.co/logo.png",
            defaultEventBannerUrl:
              "https://events-fixture.supabase.co/banner.png",
            secret: "never-return",
          },
          products: [{ ...product, secret: "never-return" }],
          formFields: [{ ...field, secret: "never-return" }],
          formFieldsGroups: [{ ...group, secret: "never-return" }],
          bookingTokens: ["never-return"],
          secret: "never-return",
        });
      }
      assertEquals(args.p_actor_id, actorId);
      if (url.pathname.endsWith("/organizer_delete_event")) {
        assertEquals(args.p_org_id, orgA);
        assertEquals(args.p_event_id, eventA);
        return Response.json({ success: true });
      }
      const payload = z.record(z.string(), z.unknown()).parse(args.p_input);
      assertEquals(payload.org_id, orgA);
      if (url.pathname.endsWith("/organizer_create_event")) {
        return Response.json({ ...event, secret: "never-return" });
      }
      if (url.pathname.endsWith("/organizer_update_event")) {
        return Response.json({
          ...event,
          title: "Renamed Event",
          description: null,
          secret: "never-return",
        });
      }
      if (url.pathname.endsWith("/organizer_duplicate_event")) {
        return Response.json({
          ...event,
          id: clonedEvent,
          slug: "cloned-event",
          title: "Clone",
          secret: "never-return",
        });
      }
    }
    throw new Error(`Unexpected events fixture route: ${url.pathname}`);
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
function request(route: string, body: unknown, auth = true) {
  return rawRequest(route, JSON.stringify(body), auth);
}
function rawRequest(route: string, body: string, auth = true) {
  return new Request(`https://edge.test/events/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer fixture-user" } : {}),
    },
    body,
  });
}
function businessCalls(calls: Call[]) {
  return calls.filter((call) =>
    call.url.pathname.startsWith("/rest/v1/rpc/organizer_")
  );
}
function quotaCalls(calls: Call[]) {
  return calls.filter((call) =>
    call.url.pathname.endsWith("/consume_rate_limit")
  );
}
const scenarios = [
  { route: "overview", body: { orgId: orgA } },
  { route: "detail", body: { eventId: eventA } },
  { route: "detail", body: { orgId: orgA, eventSlug: "fixture-event" } },
  { route: "create", body: createInput },
  {
    route: "update",
    body: {
      eventId: eventA,
      patch: { title: "Renamed Event", description: null },
    },
  },
  { route: "duplicate", body: { sourceEventId: eventA, title: "Clone" } },
  { route: "delete", body: { eventId: eventA } },
];

Deno.test("events reject absent and invalid Auth before resource reads or effects", async () => {
  for (const auth of [false, true]) {
    for (const scenario of scenarios) {
      await withFixture({ authError: auth }, async (calls) => {
        const response = await handleEventsRequest(
          request(scenario.route, scenario.body, auth),
        );
        assertEquals(response.status, 401);
        assertEquals(await response.json(), { error: "UNAUTHORIZED" });
        assertEquals(calls.length, auth ? 1 : 0);
      });
    }
  }
});

Deno.test("events overview scopes the org and returns only declared DTO columns", () =>
  withFixture({}, async (calls) => {
    const response = await handleEventsRequest(
      request("overview", { orgId: orgA }),
    );
    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.orgId, orgA);
    assertEquals(result.events[0].event.id, eventA);
    assertEquals(result.events[0].event.orgId, orgA);
    assertEquals(result.events[0].event.startsAt, event.startsAt);
    assertEquals(result.events[0].ordersCount, 2);
    assertEquals(result.events[0].paidCents, 500);
    assertEquals(JSON.stringify(result).includes("never-return"), false);
    assertEquals(calls.map((call) => call.url.pathname), [
      "/auth/v1/user",
      "/rest/v1/organization_members",
      "/rest/v1/rpc/consume_rate_limit",
      "/rest/v1/rpc/organizer_get_events_overview",
    ]);
  }));

Deno.test("events detail derives resource org and preserves options JSON during shallow DTO mapping", async () => {
  for (
    const body of [{ eventId: eventA }, {
      orgId: orgA,
      eventSlug: "fixture-event",
    }]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleEventsRequest(request("detail", body));
      assertEquals(response.status, 200);
      const result = await response.json();
      assertEquals(result.event.id, eventA);
      assertEquals(result.products[0].stockQty, 0);
      assertEquals(result.products[0].reservedQty, 0);
      assertEquals(result.formFields[0].fieldKey, "snake_key");
      assertEquals(result.formFields[0].options, optionsJson);
      assertEquals(result.formFields[0].groupId, group.id);
      assertEquals(result.formFieldsGroups[0].eventId, eventA);
      assertEquals(JSON.stringify(result).includes("never-return"), false);
      assertEquals(calls.map((call) => call.url.pathname), [
        "/auth/v1/user",
        ...("eventId" in body
          ? ["/rest/v1/events", "/rest/v1/organization_members"]
          : ["/rest/v1/organization_members", "/rest/v1/events"]),
        "/rest/v1/rpc/consume_rate_limit",
        "/rest/v1/rpc/organizer_get_event_detail_admin_core",
      ]);
    });
  }
});

Deno.test("events foreign org or derived foreign event fails before quota and business SQL", async () => {
  const foreign = [
    { route: "overview", body: { orgId: orgB } },
    { route: "detail", body: { eventId: eventB } },
    { route: "detail", body: { orgId: orgB, eventSlug: "fixture-event" } },
    { route: "create", body: { ...createInput, orgId: orgB } },
    {
      route: "update",
      body: { eventId: eventB, patch: { title: "Renamed Event" } },
    },
    { route: "duplicate", body: { sourceEventId: eventB, title: "Clone" } },
    { route: "delete", body: { eventId: eventB } },
    { route: "delete", body: { eventId: eventB, orgId: orgA } },
  ];
  for (const scenario of foreign) {
    await withFixture({}, async (calls) => {
      const response = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: "FORBIDDEN" });
      assertEquals(quotaCalls(calls).length, 0);
      assertEquals(businessCalls(calls).length, 0);
    });
  }
});

Deno.test("events reject missing or insufficient membership on every operation", async () => {
  for (const role of [null, "member"]) {
    for (const scenario of scenarios) {
      await withFixture({ role }, async (calls) => {
        const response = await handleEventsRequest(
          request(scenario.route, scenario.body),
        );
        assertEquals(response.status, 403);
        assertEquals(quotaCalls(calls).length, 0);
        assertEquals(businessCalls(calls).length, 0);
      });
    }
  }
});

Deno.test("events mutations use verified actor and resource-derived org without user metadata", async () => {
  for (const role of ["owner", "admin"]) {
    for (
      const scenario of scenarios.filter((scenario) =>
        !["overview", "detail"].includes(scenario.route)
      )
    ) {
      await withFixture({ role }, async (calls) => {
        const response = await handleEventsRequest(
          request(scenario.route, scenario.body),
        );
        assertEquals(response.status, 200);
        const result = await response.json();
        assertEquals(JSON.stringify(result).includes("never-return"), false);
        assertEquals(businessCalls(calls).length, 1);
        const args = z.record(z.string(), z.unknown()).parse(
          businessCalls(calls)[0].body,
        );
        assertEquals(args.p_actor_id, actorId);
        const membershipIndex = calls.findIndex((call) =>
          call.url.pathname === "/rest/v1/organization_members"
        );
        const quotaIndex = calls.findIndex((call) =>
          call.url.pathname.endsWith("/consume_rate_limit")
        );
        const mutationIndex = calls.findIndex((call) =>
          call.url.pathname.startsWith("/rest/v1/rpc/organizer_")
        );
        assert(
          membershipIndex >= 0 && membershipIndex < quotaIndex &&
            quotaIndex < mutationIndex,
        );
        if (scenario.route === "update") {
          assertEquals(args.p_input, {
            org_id: orgA,
            event_id: eventA,
            title: "Renamed Event",
            description: null,
          });
        }
        if (scenario.route === "duplicate") {
          assertEquals(args.p_input, {
            org_id: orgA,
            source_event_id: eventA,
            title: "Clone",
          });
        }
        if (scenario.route === "delete") {
          assertEquals(args, {
            p_actor_id: actorId,
            p_org_id: orgA,
            p_event_id: eventA,
          });
        }
      });
    }
  }
});

Deno.test("events strict input rejects reassignment, actor and system fields before lookup or quota", async () => {
  const invalid = [
    { route: "create", body: { ...createInput, userId: foreignActor } },
    { route: "create", body: { ...createInput, isPublished: true } },
    { route: "create", body: { ...createInput, soldQty: 10 } },
    { route: "create", body: { ...createInput, id: eventB } },
    {
      route: "update",
      body: { eventId: eventA, orgId: orgB, patch: { title: "Renamed Event" } },
    },
    { route: "update", body: { eventId: eventA, patch: { orgId: orgB } } },
    { route: "update", body: { eventId: eventA, patch: { reservedQty: 10 } } },
    {
      route: "update",
      body: { eventId: eventA, patch: { createdAt: timestamp } },
    },
    { route: "duplicate", body: { sourceEventId: eventA, orgId: orgB } },
    {
      route: "duplicate",
      body: { sourceEventId: eventA, actorId: foreignActor },
    },
    { route: "delete", body: { eventId: eventA, userId: foreignActor } },
    { route: "detail", body: { eventId: eventA, orgId: orgB } },
    { route: "detail", body: { eventId: eventA, eventSlug: "fixture-event" } },
    { route: "overview", body: { orgId: orgA, secret: "injected" } },
  ];
  for (const scenario of invalid) {
    await withFixture({}, async (calls) => {
      const response = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(response.status, 400);
      assertEquals(await response.json(), { error: "VALIDATION_ERROR" });
      assertEquals(calls.length, 1);
    });
  }
});

Deno.test("events nonexistent resource does not reach quota or mutation", async () => {
  for (
    const scenario of scenarios.filter((scenario) =>
      !["overview", "create"].includes(scenario.route)
    )
  ) {
    await withFixture({ resourceAbsent: true }, async (calls) => {
      const response = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(response.status, 404);
      assertEquals(await response.json(), { error: "NOT_FOUND" });
      assertEquals(quotaCalls(calls).length, 0);
      assertEquals(businessCalls(calls).length, 0);
    });
  }
});

Deno.test("events quota failures prevent read and mutation RPCs with stable retry responses", async () => {
  for (const quota of ["denied", "unavailable"] as const) {
    for (const scenario of scenarios) {
      await withFixture({ quota }, async (calls) => {
        const response = await handleEventsRequest(
          request(scenario.route, scenario.body),
        );
        assertEquals(response.status, quota === "denied" ? 429 : 503);
        assertEquals(
          response.headers.get("retry-after"),
          quota === "denied" ? "17" : "30",
        );
        assertEquals(await response.json(), {
          error: quota === "denied"
            ? "TOO_MANY_REQUESTS"
            : "RATE_LIMIT_UNAVAILABLE",
        });
        assertEquals(businessCalls(calls).length, 0);
      });
    }
  }
});

Deno.test("events malformed and oversized JSON fail before any business calls", async () => {
  for (
    const scenario of [
      { body: "{", status: 400, error: "INVALID_JSON" },
      {
        body: JSON.stringify({ padding: "x".repeat(32768) }),
        status: 413,
        error: "PAYLOAD_TOO_LARGE",
      },
    ]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleEventsRequest(
        rawRequest("create", scenario.body),
      );
      assertEquals(response.status, scenario.status);
      assertEquals(await response.json(), { error: scenario.error });
      assertEquals(calls.length, 1);
    });
  }
});

Deno.test("events resource load and malformed server DTO failures remain safe server errors", async () => {
  await withFixture({ resourceError: true }, async (calls) => {
    const response = await handleEventsRequest(
      request("detail", { eventId: eventA }),
    );
    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: "EVENT_LOAD_FAILED" });
    assertEquals(businessCalls(calls).length, 0);
    assertEquals(quotaCalls(calls).length, 0);
  });
  for (
    const scenario of scenarios
  ) {
    await withFixture({ invalidResponse: true }, async () => {
      const response = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(response.status, 500);
      assertEquals(await response.json(), { error: "UNEXPECTED_ERROR" });
    });
  }
});

Deno.test("events exact routes reject lookalikes without business work", async () => {
  await withFixture({}, async (calls) => {
    const response = await handleEventsRequest(
      new Request("https://edge.test/other/events/create", {
        method: "POST",
        headers: {
          authorization: "Bearer fixture-user",
          "content-type": "application/json",
        },
        body: JSON.stringify(createInput),
      }),
    );
    assertEquals(response.status, 404);
    assertEquals(await response.json(), { error: "NOT_FOUND" });
    assertEquals(calls.length, 1);
  });
});

Deno.test("events dates and empty patches are validated before resource lookup or quota", async () => {
  for (
    const scenario of [
      { route: "update", body: { eventId: eventA, patch: {} } },
      { route: "create", body: { ...createInput, startsAt: "invalid-date" } },
      { route: "create", body: { ...createInput, title: "   " } },
      { route: "update", body: { eventId: eventA, patch: { title: "   " } } },
      { route: "duplicate", body: { sourceEventId: eventA, title: "ab" } },
      {
        route: "create",
        body: { ...createInput, startsAt: "2020-01-01T12:00:00.000Z" },
      },
      {
        route: "update",
        body: { eventId: eventA, patch: { startsAt: "invalid-date" } },
      },
      {
        route: "create",
        body: { ...createInput, endsAt: "2027-12-01T10:00:00.000Z" },
      },
      {
        route: "create",
        body: {
          ...createInput,
          registrationDeadline: "2027-12-01T13:00:00.000Z",
        },
      },
    ]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(response.status, 400);
      assertEquals(await response.json(), { error: "VALIDATION_ERROR" });
      assertEquals(calls.length, 1);
    });
  }
});

Deno.test("events SQL errors return stable codes without database details", async () => {
  for (
    const scenario of [
      {
        message: "VALIDATION_ERROR: private-detail",
        status: 400,
        error: "VALIDATION_ERROR",
      },
      { message: "CONFLICT: private-detail", status: 409, error: "CONFLICT" },
      { message: "NOT_FOUND", status: 404, error: "NOT_FOUND" },
      {
        message: "PLAN_LIMIT: private-detail",
        status: 409,
        error: "PLAN_LIMIT",
      },
      {
        message: "private-database-detail",
        status: 500,
        error: "ORGANIZER_OPERATION_FAILED",
      },
    ]
  ) {
    await withFixture(
      { databaseError: { message: scenario.message } },
      async () => {
        const response = await handleEventsRequest(
          request("create", createInput),
        );
        assertEquals(response.status, scenario.status);
        assertEquals(await response.json(), { error: scenario.error });
      },
    );
  }
});

Deno.test("events busy deletion returns a retryable safe conflict without SQL details", async () => {
  await withFixture(
    { databaseError: { message: "RESOURCE_BUSY: private-lock-detail" } },
    async (calls) => {
      const response = await handleEventsRequest(
        request("delete", { eventId: eventA }),
      );
      assertEquals(response.status, 409);
      assertEquals(await response.json(), { error: "RESOURCE_BUSY" });
      assertEquals(businessCalls(calls).length, 1);
      assertEquals(businessCalls(calls)[0].body, {
        p_actor_id: actorId,
        p_org_id: orgA,
        p_event_id: eventA,
      });
      assertEquals(response.headers.get("retry-after"), null);
    },
  );
});
