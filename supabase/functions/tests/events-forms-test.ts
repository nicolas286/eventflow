import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { handleEventsRequest } from "../events/index.ts";

const actor = "b2300000-0000-4000-8000-000000000001";
const foreignActor = "b2300000-0000-4000-8000-000000000002";
const orgA = "b2300000-0000-4000-8000-000000000011";
const orgB = "b2300000-0000-4000-8000-000000000012";
const eventA = "b2300000-0000-4000-8000-000000000021";
const eventB = "b2300000-0000-4000-8000-000000000022";
const fieldA = "b2300000-0000-4000-8000-000000000031";
const fieldB = "b2300000-0000-4000-8000-000000000032";
const groupA = "b2300000-0000-4000-8000-000000000041";
const groupB = "b2300000-0000-4000-8000-000000000042";
const stamp = "2026-10-03T12:00:00.000Z";
const field = {
  id: fieldA,
  event_id: eventA,
  group_id: groupA,
  label: "Fixture Choice",
  field_key: "choice_raw",
  field_type: "select",
  options: ["  RAW_Camel_Snake  "],
  is_required: false,
  is_active: true,
  sort_order: 1,
  created_at: stamp,
  updated_at: stamp,
};
const group = {
  id: groupA,
  event_id: eventA,
  label: "Fixture Group",
  description: null,
  is_active: true,
  sort_order: 1,
  created_at: stamp,
  updated_at: stamp,
};
const createField = {
  eventId: eventA,
  groupId: groupA,
  label: "Fixture Choice",
  fieldKey: "choice_raw",
  fieldType: "select",
  options: field.options,
  isRequired: false,
  isActive: true,
  sortOrder: 1,
};
const createGroup = {
  eventId: eventA,
  label: "Fixture Group",
  description: null,
  isActive: true,
  sortOrder: 1,
};
type Call = { url: URL; body: unknown; headers: Headers };
type Options = {
  authError?: boolean;
  role?: string | null;
  resourceAbsent?: boolean;
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
    SUPABASE_URL: "https://forms-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: "fixture-forms-salt",
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
    calls.push({ url, body, headers: request.headers });
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
      const foreign = url.searchParams.get("id") === `eq.${eventB}`;
      return Response.json({
        id: foreign ? eventB : eventA,
        org_id: foreign ? orgB : orgA,
      });
    }
    if (
      ["/rest/v1/event_form_fields", "/rest/v1/event_form_field_groups"]
        .includes(url.pathname)
    ) {
      assertEquals(request.method, "GET");
      if (options.resourceError) {
        return Response.json({ message: "private-resource-detail" }, {
          status: 500,
        });
      }
      const isGroup = url.pathname.endsWith("groups");
      const expectedId = isGroup ? groupA : fieldA;
      const foreignId = isGroup ? groupB : fieldB;
      const id = url.searchParams.get("id");
      const scope = url.searchParams.get("event_id");
      const projection = url.searchParams.get("select") ?? "";
      if (id?.startsWith("in.")) {
        assertEquals(scope, `eq.${eventA}`);
        assertEquals(url.searchParams.get("limit"), "100");
        const ids = id.slice(4, -1).split(",");
        return Response.json(
          options.resourceAbsent
            ? []
            : ids.filter((value) => value.toLowerCase() !== foreignId).map((
              value,
            ) => ({
              id: value.toLowerCase(),
              event_id: eventA,
            })),
        );
      }
      if (options.resourceAbsent) return Response.json(null);
      const foreign = id === `eq.${foreignId}`;
      if (scope && foreign) return Response.json(null);
      if (!projection.includes("label")) {
        return Response.json({
          id: foreign ? foreignId : expectedId,
          event_id: foreign ? eventB : eventA,
        });
      }
      assertEquals(scope, `eq.${eventA}`);
      assertEquals(id, `eq.${expectedId}`);
      assert(!projection.includes("*"));
      return Response.json(
        options.malformedOutput
          ? { id: "private-response-detail" }
          : { ...(isGroup ? group : field), private_secret: "never-return" },
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
      assert([
        "organizer_create_event_form_field",
        "organizer_update_event_form_field",
        "organizer_delete_event_form_field",
        "organizer_create_event_form_field_group",
        "organizer_update_event_form_field_group",
        "organizer_delete_event_form_field_group",
        "organizer_reorder_event_form",
      ].some((name) => url.pathname === `/rest/v1/rpc/${name}`));
      const args = z.record(z.string(), z.unknown()).parse(body);
      assertEquals(args.p_actor_id, actor);
      if (options.databaseError) {
        return Response.json(options.databaseError, { status: 400 });
      }
      if (url.pathname.includes("delete")) {
        assertEquals(args.p_org_id, orgA);
        assertEquals(args.p_event_id, eventA);
        assertEquals(
          url.pathname.includes("group") ? args.p_group_id : args.p_field_id,
          url.pathname.includes("group") ? groupA : fieldA,
        );
        return Response.json(
          options.malformedOutput
            ? { success: false, private_secret: "private-response-detail" }
            : { success: true },
        );
      }
      const patch = z.record(z.string(), z.unknown()).parse(args.p_input);
      assertEquals(patch.org_id, orgA);
      assertEquals(patch.event_id, eventA);
      if (url.pathname.includes("reorder")) {
        return Response.json(
          options.malformedOutput
            ? { success: false, private_secret: "private-response-detail" }
            : { success: true },
        );
      }
      const isGroup = url.pathname.includes("group");
      if (url.pathname.includes("update")) {
        assertEquals(
          isGroup ? patch.group_id : patch.field_id,
          isGroup ? groupA : fieldA,
        );
      }
      return Response.json(
        options.malformedOutput ? { id: "private-response-detail" } : {
          ...(isGroup ? group : field),
          ...patch,
          private_secret: "never-return",
        },
      );
    }
    throw new Error(`Unexpected forms fixture path ${url.pathname}`);
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
  prefix = "/events/forms/",
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
    (call.url.pathname.startsWith("/rest/v1/event_form_") &&
      call.url.searchParams.get("select")?.includes("label"))
  );
}
function quotas(calls: Call[]) {
  return calls.filter((call) =>
    call.url.pathname.endsWith("/consume_rate_limit")
  );
}
const scenarios = [
  { route: "fields/create", body: createField },
  {
    route: "fields/update",
    body: { fieldId: fieldA, patch: { label: "Renamed Choice" } },
  },
  { route: "fields/read", body: { fieldId: fieldA } },
  { route: "fields/delete", body: { id: fieldA } },
  { route: "groups/create", body: createGroup },
  {
    route: "groups/update",
    body: { groupId: groupA, patch: { label: "Renamed Group" } },
  },
  { route: "groups/read", body: { groupId: groupA } },
  { route: "groups/delete", body: { id: groupA } },
  {
    route: "reorder",
    body: {
      eventId: eventA,
      fields: [{ id: fieldA, sortOrder: 3 }],
      groups: [{ id: groupA, sortOrder: 4 }],
    },
  },
];

Deno.test("forms missing invalid Auth denies every operation before lookup", async () => {
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

Deno.test("forms owner admin permitted and other roles refused before quota on every operation", async () => {
  for (const role of ["owner", "admin", "member", "viewer", null]) {
    await fixture({ role }, async (calls) => {
      const allowed = role === "owner" || role === "admin";
      for (const scenario of scenarios) {
        assertEquals(
          (await handleEventsRequest(request(scenario.route, scenario.body)))
            .status,
          allowed ? 200 : 403,
          scenario.route,
        );
      }
      if (!allowed) {
        assertEquals(effects(calls).length, 0);
        assertEquals(quotas(calls).length, 0);
      }
    });
  }
});

Deno.test("forms field group references derive organization and reject tenant B before quota", async () => {
  await fixture({}, async (calls) => {
    for (
      const scenario of [
        {
          route: "fields/create",
          body: { ...createField, eventId: eventB, groupId: null },
        },
        { route: "groups/create", body: { ...createGroup, eventId: eventB } },
        {
          route: "fields/update",
          body: { fieldId: fieldB, patch: { label: "Foreign Choice" } },
        },
        { route: "fields/read", body: { fieldId: fieldB } },
        { route: "fields/delete", body: { id: fieldB } },
        {
          route: "groups/update",
          body: { groupId: groupB, patch: { label: "Foreign Group" } },
        },
        { route: "groups/read", body: { groupId: groupB } },
        { route: "groups/delete", body: { id: groupB } },
        {
          route: "reorder",
          body: { eventId: eventB, fields: [{ id: fieldB, sortOrder: 1 }] },
        },
      ]
    ) {
      assertEquals(
        (await handleEventsRequest(request(scenario.route, scenario.body)))
          .status,
        403,
        scenario.route,
      );
    }
    assertEquals(effects(calls).length, 0);
    assertEquals(quotas(calls).length, 0);
  });
});

Deno.test("forms create update reject foreign group before quota with event-scoped lookup", async () => {
  await fixture({}, async (calls) => {
    for (
      const scenario of [
        { route: "fields/create", body: { ...createField, groupId: groupB } },
        {
          route: "fields/update",
          body: { fieldId: fieldA, patch: { groupId: groupB } },
        },
      ]
    ) {
      const result = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(result.status, 400);
      assertEquals(await result.json(), { error: "VALIDATION_ERROR" });
    }
    assert(
      calls.some((call) =>
        call.url.pathname === "/rest/v1/event_form_field_groups" &&
        call.url.searchParams.get("id") === `eq.${groupB}` &&
        call.url.searchParams.get("event_id") === `eq.${eventA}`
      ),
    );
    assertEquals(effects(calls).length, 0);
    assertEquals(quotas(calls).length, 0);
  });
});

Deno.test("forms options strings legacy objects retain exact whitespace case and business values", async () => {
  for (
    const options of [["  RAW_Camel_Snake  ", " snake_RAW "], [{
      label: "  Label_Camel_Snake  ",
      value: "  Value_Camel_Snake  ",
    }]]
  ) {
    await fixture({}, async (calls) => {
      for (
        const scenario of [
          { route: "fields/create", body: { ...createField, options } },
          {
            route: "fields/update",
            body: { fieldId: fieldA, patch: { options } },
          },
        ]
      ) {
        const result = await handleEventsRequest(
          request(scenario.route, scenario.body),
        );
        assertEquals(result.status, 200);
        assertEquals((await result.json()).options, options);
      }
      for (const call of effects(calls)) {
        const args = z.record(z.string(), z.unknown()).parse(call.body);
        assertEquals(
          z.record(z.string(), z.unknown()).parse(args.p_input).options,
          options,
        );
      }
    });
  }
});

Deno.test("forms reads are scoped explicit DTOs with JSON values unchanged", async () => {
  await fixture({}, async () => {
    const result = await handleEventsRequest(
      request(
        "fields/read",
        { fieldId: fieldA },
        true,
        "/functions/v1/events/forms/",
      ),
    );
    assertEquals(result.status, 200);
    const dto = await result.json();
    assertEquals(dto.options, field.options);
    assertEquals(dto.fieldKey, "choice_raw");
    assertEquals(dto.eventId, eventA);
    assertEquals(dto.groupId, groupA);
    assertEquals(dto.private_secret, undefined);
    assertEquals(dto.event_id, undefined);
    assertEquals(dto.orgId, undefined);
    const grouped = await handleEventsRequest(
      request("groups/read", { groupId: groupA }),
    );
    assertEquals(grouped.status, 200);
    const groupDto = await grouped.json();
    assertEquals(groupDto.eventId, eventA);
    assertEquals(groupDto.description, null);
    assertEquals(groupDto.private_secret, undefined);
  });
});

Deno.test("forms patch omission and explicit null preserve the precise SQL payload", async () => {
  await fixture({}, async (calls) => {
    const fieldResult = await handleEventsRequest(
      request("fields/update", {
        fieldId: fieldA,
        patch: { groupId: null, options: null, fieldType: "text" },
      }),
    );
    assertEquals(fieldResult.status, 200);
    assertEquals(effects(calls)[0].body, {
      p_actor_id: actor,
      p_input: {
        org_id: orgA,
        event_id: eventA,
        field_id: fieldA,
        group_id: null,
        options: null,
        field_type: "text",
      },
    });
    const groupResult = await handleEventsRequest(
      request("groups/update", {
        groupId: groupA,
        patch: { description: null, isActive: false },
      }),
    );
    assertEquals(groupResult.status, 200);
    assertEquals(effects(calls)[1].body, {
      p_actor_id: actor,
      p_input: {
        org_id: orgA,
        event_id: eventA,
        group_id: groupA,
        description: null,
        is_active: false,
      },
    });
  });
});

Deno.test("forms delete sends verified actor and every derived resource scope", async () => {
  await fixture({}, async (calls) => {
    for (
      const scenario of scenarios.filter((scenario) =>
        scenario.route.endsWith("delete")
      )
    ) {
      const result = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(result.status, 200);
      assertEquals(await result.json(), { success: true });
    }
    assertEquals(effects(calls)[0].body, {
      p_actor_id: actor,
      p_org_id: orgA,
      p_event_id: eventA,
      p_field_id: fieldA,
    });
    assertEquals(effects(calls)[1].body, {
      p_actor_id: actor,
      p_org_id: orgA,
      p_event_id: eventA,
      p_group_id: groupA,
    });
  });
});

Deno.test("forms reorder verifies all ids before quota and maps only nested sort_order", async () => {
  await fixture({}, async (calls) => {
    for (
      const body of [scenarios[8].body, {
        eventId: eventA,
        fields: [{ id: fieldA, sortOrder: 5 }],
      }, { eventId: eventA, groups: [{ id: groupA, sortOrder: 6 }] }]
    ) {
      const result = await handleEventsRequest(request("reorder", body));
      assertEquals(result.status, 200);
      assertEquals(await result.json(), { success: true });
    }
    assertEquals(effects(calls)[0].body, {
      p_actor_id: actor,
      p_input: {
        org_id: orgA,
        event_id: eventA,
        fields: [{ id: fieldA, sort_order: 3 }],
        groups: [{ id: groupA, sort_order: 4 }],
      },
    });
    assertEquals(effects(calls)[1].body, {
      p_actor_id: actor,
      p_input: {
        org_id: orgA,
        event_id: eventA,
        fields: [{ id: fieldA, sort_order: 5 }],
        groups: [],
      },
    });
    assertEquals(effects(calls)[2].body, {
      p_actor_id: actor,
      p_input: {
        org_id: orgA,
        event_id: eventA,
        fields: [],
        groups: [{ id: groupA, sort_order: 6 }],
      },
    });
  });
});

Deno.test("forms reorder rejects foreign ids atomically before any quota or SQL mutation", async () => {
  for (
    const body of [
      {
        eventId: eventA,
        fields: [{ id: fieldA, sortOrder: 1 }, { id: fieldB, sortOrder: 2 }],
      },
      {
        eventId: eventA,
        groups: [{ id: groupA, sortOrder: 1 }, { id: groupB, sortOrder: 2 }],
      },
      {
        eventId: eventA,
        fields: [{ id: fieldA, sortOrder: 1 }],
        groups: [{ id: groupB, sortOrder: 2 }],
      },
    ]
  ) {
    await fixture({}, async (calls) => {
      const result = await handleEventsRequest(request("reorder", body));
      assertEquals(result.status, 400);
      assertEquals(await result.json(), { error: "VALIDATION_ERROR" });
      assertEquals(effects(calls).length, 0);
      assertEquals(quotas(calls).length, 0);
    });
  }
});

Deno.test("forms reorder accepts exactly100 fields and100 groups within their bounds", async () => {
  await fixture({}, async (calls) => {
    const fields = Array.from({ length: 100 }, (_, index) => ({
      id: `b2300000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
      sortOrder: 1000,
    }));
    const groups = Array.from({ length: 100 }, (_, index) => ({
      id: `b2300000-0000-4000-8000-${String(index + 300).padStart(12, "0")}`,
      sortOrder: 10000,
    }));
    const result = await handleEventsRequest(
      request("reorder", { eventId: eventA, fields, groups }),
    );
    assertEquals(result.status, 200);
    assertEquals(await result.json(), { success: true });
    assertEquals(effects(calls).length, 1);
    const args = z.record(z.string(), z.unknown()).parse(
      effects(calls)[0].body,
    );
    assertEquals(args.p_input, {
      org_id: orgA,
      event_id: eventA,
      fields: fields.map((entry) => ({
        id: entry.id,
        sort_order: entry.sortOrder,
      })),
      groups: groups.map((entry) => ({
        id: entry.id,
        sort_order: entry.sortOrder,
      })),
    });
  });
});

Deno.test("forms reorder accepts uppercase UUIDs returned canonically lowercase by PostgREST", async () => {
  await fixture({}, async (calls) => {
    const result = await handleEventsRequest(request("reorder", {
      eventId: eventA,
      fields: [{ id: fieldA.toUpperCase(), sortOrder: 2 }],
      groups: [{ id: groupA.toUpperCase(), sortOrder: 3 }],
    }));
    assertEquals(result.status, 200);
    assertEquals(await result.json(), { success: true });
    assertEquals(effects(calls).length, 1);
    const args = z.record(z.string(), z.unknown()).parse(
      effects(calls)[0].body,
    );
    assertEquals(args.p_input, {
      org_id: orgA,
      event_id: eventA,
      fields: [{ id: fieldA.toUpperCase(), sort_order: 2 }],
      groups: [{ id: groupA.toUpperCase(), sort_order: 3 }],
    });
  });
});

Deno.test("forms actor timestamps ids and event reassignment are rejected before resource lookup", async () => {
  await fixture({}, async (calls) => {
    for (
      const [key, value] of Object.entries({
        id: fieldB,
        orgId: orgB,
        userId: foreignActor,
        p_actor_id: foreignActor,
        createdAt: stamp,
        updatedAt: stamp,
        unknown: true,
      })
    ) {
      for (
        const scenario of [
          { route: "fields/create", body: { ...createField, [key]: value } },
          { route: "groups/create", body: { ...createGroup, [key]: value } },
          {
            route: "fields/update",
            body: {
              fieldId: fieldA,
              patch: { label: "Updated Choice", [key]: value },
            },
          },
          {
            route: "groups/update",
            body: {
              groupId: groupA,
              patch: { label: "Updated Group", [key]: value },
            },
          },
        ]
      ) {
        assertEquals(
          (await handleEventsRequest(request(scenario.route, scenario.body)))
            .status,
          400,
          scenario.route,
        );
      }
    }
    for (
      const scenario of [
        {
          route: "fields/update",
          body: { fieldId: fieldA, patch: { eventId: eventB } },
        },
        {
          route: "groups/update",
          body: { groupId: groupA, patch: { eventId: eventB } },
        },
        { route: "fields/read", body: { fieldId: fieldA, eventId: eventB } },
        { route: "groups/delete", body: { id: groupA, orgId: orgA } },
        {
          route: "reorder",
          body: {
            eventId: eventA,
            fields: [{ id: fieldA, sortOrder: 1, label: "Injected" }],
          },
        },
      ]
    ) {
      assertEquals(
        (await handleEventsRequest(request(scenario.route, scenario.body)))
          .status,
        400,
      );
    }
    assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
  });
});

Deno.test("forms malformed options empty patches and invalid bounded reorder fail before lookup", async () => {
  await fixture({}, async (calls) => {
    for (
      const options of [[], ["  "], ["x".repeat(81)], [{
        label: "Valid",
        value: " ",
      }], [{ label: "Valid", value: "Valid", businessKey: "forbidden" }]]
    ) {
      assertEquals(
        (await handleEventsRequest(
          request("fields/create", { ...createField, options }),
        )).status,
        400,
      );
      assertEquals(
        (await handleEventsRequest(
          request("fields/update", { fieldId: fieldA, patch: { options } }),
        )).status,
        400,
      );
    }
    for (
      const scenario of [
        {
          route: "fields/create",
          body: { ...createField, fieldKey: "Bad_KEY" },
        },
        { route: "fields/update", body: { fieldId: fieldA, patch: {} } },
        { route: "groups/update", body: { groupId: groupA, patch: {} } },
        { route: "reorder", body: { eventId: eventA } },
        { route: "reorder", body: { eventId: eventA, fields: [], groups: [] } },
        {
          route: "reorder",
          body: {
            eventId: eventA,
            fields: [{ id: fieldA, sortOrder: 1 }, {
              id: fieldA,
              sortOrder: 2,
            }],
          },
        },
        {
          route: "reorder",
          body: {
            eventId: eventA,
            groups: [{ id: groupA, sortOrder: 1 }, {
              id: groupA,
              sortOrder: 2,
            }],
          },
        },
        {
          route: "reorder",
          body: { eventId: eventA, fields: [{ id: fieldA, sortOrder: -1 }] },
        },
        {
          route: "reorder",
          body: { eventId: eventA, fields: [{ id: fieldA, sortOrder: 0.5 }] },
        },
        {
          route: "reorder",
          body: { eventId: eventA, fields: [{ id: fieldA, sortOrder: 1001 }] },
        },
        {
          route: "reorder",
          body: { eventId: eventA, groups: [{ id: groupA, sortOrder: 10001 }] },
        },
        {
          route: "reorder",
          body: {
            eventId: eventA,
            fields: [{ id: fieldA, sortOrder: 1 }, {
              id: fieldA.toUpperCase(),
              sortOrder: 2,
            }],
          },
        },
        {
          route: "reorder",
          body: {
            eventId: eventA,
            fields: Array.from(
              { length: 101 },
              (_, index) => ({
                id: `b2300000-0000-4000-8000-${
                  String(index + 100).padStart(12, "0")
                }`,
                sortOrder: index,
              }),
            ),
          },
        },
        {
          route: "reorder",
          body: {
            eventId: eventA,
            groups: Array.from(
              { length: 101 },
              (_, index) => ({
                id: `b2300000-0000-4000-8000-${
                  String(index + 100).padStart(12, "0")
                }`,
                sortOrder: index,
              }),
            ),
          },
        },
      ]
    ) {
      assertEquals(
        (await handleEventsRequest(request(scenario.route, scenario.body)))
          .status,
        400,
        scenario.route,
      );
    }
    assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
  });
});

Deno.test("forms quota429 or unavailable503 blocks every effect after resource membership", async () => {
  for (const quota of ["denied", "unavailable"] as const) {
    await fixture({ quota }, async (calls) => {
      for (const scenario of scenarios) {
        const result = await handleEventsRequest(
          request(scenario.route, scenario.body),
        );
        assertEquals(
          result.status,
          quota === "denied" ? 429 : 503,
          scenario.route,
        );
        assertEquals(
          (await result.json()).error,
          quota === "denied" ? "TOO_MANY_REQUESTS" : "RATE_LIMIT_UNAVAILABLE",
        );
        if (quota === "denied") {
          assertEquals(result.headers.get("retry-after"), "17");
        }
      }
      assertEquals(effects(calls).length, 0);
      assert(quotas(calls).length > 0);
    });
  }
});

Deno.test("forms missing resources and DB lookup errors fail safely before quota", async () => {
  for (const options of [{ resourceAbsent: true }, { resourceError: true }]) {
    await fixture(options, async (calls) => {
      for (const scenario of [scenarios[2], scenarios[6]]) {
        const result = await handleEventsRequest(
          request(scenario.route, scenario.body),
        );
        assertEquals(result.status, options.resourceError ? 500 : 404);
        assert(!(await result.text()).includes("private-resource-detail"));
      }
      assertEquals(effects(calls).length, 0);
      assertEquals(quotas(calls).length, 0);
    });
  }
});

Deno.test("forms malformed JSON and inclusive65536 cap fail before lookups", async () => {
  await fixture({}, async (calls) => {
    assertEquals(
      (await handleEventsRequest(rawRequest("fields/create", "{"))).status,
      400,
    );
    assertEquals(
      (await handleEventsRequest(
        rawRequest("fields/create", " ".repeat(65537)),
      )).status,
      413,
    );
    assertEquals(
      (await handleEventsRequest(
        rawRequest("fields/create", " ".repeat(65536)),
      )).status,
      400,
    );
    assert(calls.every((call) => call.url.pathname === "/auth/v1/user"));
  });
});

Deno.test("forms malformed server DTO output remains a safe500 on every operation", async () => {
  await fixture({ malformedOutput: true }, async () => {
    for (const scenario of scenarios) {
      const result = await handleEventsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(result.status, 500, scenario.route);
      assertEquals(await result.json(), { error: "UNEXPECTED_ERROR" });
    }
  });
});

Deno.test("forms SQL errors expose safe conflict validation and missing-resource codes", async () => {
  for (
    const [databaseError, status, code] of [
      [{ message: "private FK detail", code: "23503" }, 409, "RESOURCE_IN_USE"],
      [{ message: "PLAN_LIMIT: private plan" }, 409, "PLAN_LIMIT"],
      [{ message: "VALIDATION_ERROR: private input" }, 400, "VALIDATION_ERROR"],
      [{ message: "NOT_FOUND: private resource" }, 404, "NOT_FOUND"],
      [{ message: "private SQL detail" }, 500, "ORGANIZER_OPERATION_FAILED"],
      [{ message: "RATE_LIMITED: private limit" }, 429, "TOO_MANY_REQUESTS"],
    ] as const
  ) {
    await fixture({ databaseError }, async () => {
      const result = await handleEventsRequest(
        request("fields/delete", { id: fieldA }),
      );
      assertEquals(result.status, status);
      assertEquals(await result.json(), { error: code });
      if (status === 429) assertEquals(result.headers.get("retry-after"), "60");
    });
  }
});

Deno.test("forms exact routes refuse lookalikes without any business effect", async () => {
  await fixture({}, async (calls) => {
    assertEquals(
      (await handleEventsRequest(
        request("fields/read-extra", { fieldId: fieldA }),
      )).status,
      404,
    );
    assertEquals(
      (await handleEventsRequest(
        request(
          "fields/read",
          { fieldId: fieldA },
          true,
          "/events-extra/forms/",
        ),
      )).status,
      404,
    );
    assertEquals(effects(calls).length, 0);
    assertEquals(quotas(calls).length, 0);
  });
});
