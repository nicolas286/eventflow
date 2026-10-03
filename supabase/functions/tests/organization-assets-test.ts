import { assert, assertEquals, assertMatch } from "@std/assert";
import {
  assetUploadResponseSchema,
  MAX_ASSET_BYTES,
} from "../../../shared/schemas/organization-assets.ts";
import { handleOrganizationAssetsRequest } from "../organizations/assets.ts";

const orgA = "b1300000-0000-4000-8000-000000000011";
const orgB = "b1300000-0000-4000-8000-000000000012";
const actorId = "b1300000-0000-4000-8000-000000000001";
const eventA = "b1300000-0000-4000-8000-000000000021";
const eventB = "b1300000-0000-4000-8000-000000000022";
const assetId = "b1300000-0000-4000-8000-000000000031";
// Real 1x1 images generated with Pillow, no customer assets.
const imageFixtures = [
  {
    mime: "image/png",
    ext: "png",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQC8gDAAFsAN1urcuHAAAAAElFTkSuQmCC",
  },
  {
    mime: "image/gif",
    ext: "gif",
    base64: "R0lGODdhAQABAIEAAB5QbgAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==",
  },
  {
    mime: "image/webp",
    ext: "webp",
    base64:
      "UklGRjQAAABXRUJQVlA4ICgAAACQAQCdASoBAAEAAUAmJZgCdLoAA5gA/vWJH+rsT4T9B/3HYG67xAAA",
  },
  {
    mime: "image/jpeg",
    ext: "jpg",
    base64:
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDg6KKK9Q8c/9k=",
  },
];
function decode(base64: string) {
  return Uint8Array.from(atob(base64), (value) => value.charCodeAt(0));
}
const png = decode(imageFixtures[0].base64);
type Call = {
  url: URL;
  headers: Headers;
  body: unknown;
  method: string;
  bytes: Uint8Array;
};
type Options = {
  authError?: boolean;
  role?: string | null;
  quota?: "denied" | "unavailable";
  storageError?: boolean;
  eventError?: boolean;
};
async function withFixture(
  options: Options,
  run: (calls: Call[]) => Promise<void>,
) {
  const env: Record<string, string> = {
    SUPABASE_URL: "https://assets-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: "fixture-assets-salt",
  };
  const previousEnv = new Map(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  const previousFetch = globalThis.fetch;
  const calls: Call[] = [];
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const bytes = new Uint8Array(await request.arrayBuffer());
    const binary = url.pathname.startsWith("/storage/v1/object/public-assets/");
    const text = new TextDecoder().decode(bytes);
    const body: unknown = binary || !text ? null : JSON.parse(text);
    calls.push({
      url,
      headers: request.headers,
      body,
      method: request.method,
      bytes,
    });
    if (url.pathname === "/auth/v1/user") {
      assertEquals(request.headers.get("authorization"), "Bearer fixture-user");
      if (options.authError) {
        return Response.json({ code: "bad_jwt", message: "Invalid JWT" }, {
          status: 401,
        });
      }
      return Response.json({
        id: actorId,
        email: "asset@example.test",
        user_metadata: { orgId: orgB, role: "owner" },
      });
    }
    assertEquals(
      request.headers.get("authorization"),
      "Bearer fixture-service",
    );
    assertEquals(request.headers.get("apikey"), "fixture-service");
    if (url.pathname === "/rest/v1/organization_members") {
      assertEquals(url.searchParams.get("user_id"), `eq.${actorId}`);
      assertEquals(url.searchParams.get("select"), "role");
      return Response.json(
        url.searchParams.get("org_id") === `eq.${orgA}` && options.role !== null
          ? { role: options.role ?? "admin" }
          : null,
      );
    }
    if (url.pathname === "/rest/v1/events") {
      assertEquals(url.searchParams.get("org_id"), `eq.${orgA}`);
      assertEquals(url.searchParams.get("select"), "id");
      assert(url.searchParams.has("id"));
      if (options.eventError) {
        return Response.json({ message: "private-resource-detail" }, {
          status: 500,
        });
      }
      return Response.json(
        url.searchParams.get("id") === `eq.${eventA}` ? { id: eventA } : null,
      );
    }
    if (url.pathname === "/rest/v1/rpc/consume_rate_limit") {
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
    if (url.pathname.startsWith("/storage/v1/object/public-assets")) {
      if (options.storageError) {
        return Response.json({
          statusCode: "500",
          message: "private-storage-detail",
          error: "private-error",
        }, { status: 500 });
      }
      if (request.method === "DELETE") return Response.json([]);
      assertEquals(request.method, "POST");
      assertEquals(request.headers.get("x-upsert"), "false");
      assertEquals(request.headers.get("cache-control"), "max-age=0");
      const path = url.pathname.slice(
        "/storage/v1/object/public-assets/".length,
      );
      return Response.json({ Id: assetId, Key: `public-assets/${path}` });
    }
    throw new Error(`Unexpected fixture path: ${url.pathname}`);
  };
  try {
    await run(calls);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previousEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}
function upload(
  query: Record<string, string | undefined> = { orgId: orgA, kind: "logo" },
  body: BodyInit = png,
  mime = "image/png",
  authenticated = true,
  headers: Record<string, string | undefined> = {},
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, value);
  }
  const requestHeaders = new Headers({ "content-type": mime });
  if (authenticated) requestHeaders.set("authorization", "Bearer fixture-user");
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) requestHeaders.set(key, value);
  }
  return new Request(
    `https://edge.test/organizations/assets/upload?${params}`,
    {
      method: "POST",
      headers: requestHeaders,
      body,
    },
  );
}
function deletion(body: unknown, authenticated = true) {
  return new Request("https://edge.test/organizations/assets/delete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer fixture-user" } : {}),
    },
    body: JSON.stringify(body),
  });
}
function storageCalls(calls: Call[]) {
  return calls.filter((call) => call.url.pathname.startsWith("/storage/"));
}
function quotaCalls(calls: Call[]) {
  return calls.filter((call) =>
    call.url.pathname.endsWith("/consume_rate_limit")
  );
}

Deno.test("assets reject absent/invalid session before any data or binary read", async () => {
  for (
    const scenario of [{ authenticated: false, authError: false }, {
      authenticated: true,
      authError: true,
    }]
  ) {
    await withFixture({ authError: scenario.authError }, async (calls) => {
      const req = upload(undefined, png, "image/png", scenario.authenticated);
      const response = await handleOrganizationAssetsRequest(req);
      assertEquals(response.status, 401);
      assertEquals(await response.json(), { error: "UNAUTHORIZED" });
      assertEquals(calls.length, scenario.authenticated ? 1 : 0);
      assertEquals(req.bodyUsed, false);
    });
  }
});
Deno.test("assets validate every real image container and impose immutable scoped paths", async () => {
  for (const role of ["owner", "admin"]) {
    for (const fixture of imageFixtures) {
      await withFixture({ role }, async (calls) => {
        const bytes = decode(fixture.base64);
        const response = await handleOrganizationAssetsRequest(
          upload(undefined, bytes, fixture.mime),
        );
        assertEquals(response.status, 200);
        const result = assetUploadResponseSchema.parse(await response.json());
        assertMatch(
          result.path,
          new RegExp(`^orgs/${orgA}/logo/[0-9a-f-]{36}\\.${fixture.ext}$`),
        );
        assertEquals(
          result.publicUrl,
          `https://assets-fixture.supabase.co/storage/v1/object/public/public-assets/${result.path}`,
        );
        assert(result.publicUrlWithBust.startsWith(`${result.publicUrl}?v=`));
        assertEquals(storageCalls(calls)[0].bytes, bytes);
        assertEquals(
          storageCalls(calls)[0].headers.get("content-type"),
          fixture.mime,
        );
        assertEquals(calls.map((call) => call.url.pathname).slice(0, 3), [
          "/auth/v1/user",
          "/rest/v1/organization_members",
          "/rest/v1/rpc/consume_rate_limit",
        ]);
      });
    }
  }
});
Deno.test("asset parser accepts the existing project WebP logo", async () => {
  const bytes = await Deno.readFile(
    new URL("../../../src/assets/logo.webp", import.meta.url),
  );
  await withFixture({}, async (calls) => {
    const response = await handleOrganizationAssetsRequest(
      upload(undefined, bytes, "image/webp"),
    );
    assertEquals(response.status, 200);
    assert(
      assetUploadResponseSchema.parse(await response.json()).path.endsWith(
        ".webp",
      ),
    );
    assertEquals(storageCalls(calls)[0].bytes, bytes);
  });
});
Deno.test("asset replacement creates a different key and default/event kinds retain correct prefixes", async () => {
  await withFixture({}, async () => {
    const keys: string[] = [];
    for (let n = 0; n < 2; n++) {
      const response = await handleOrganizationAssetsRequest(upload());
      assertEquals(response.status, 200);
      keys.push(assetUploadResponseSchema.parse(await response.json()).path);
    }
    assert(keys[0] !== keys[1]);
  });
  for (
    const scenario of [{
      query: { orgId: orgA, kind: "default_banner" },
      prefix: `orgs/${orgA}/default_banner/`,
    }, {
      query: { orgId: orgA, kind: "event_banner", eventId: eventA },
      prefix: `orgs/${orgA}/events/${eventA}/banner/`,
    }]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationAssetsRequest(
        upload(scenario.query),
      );
      assertEquals(response.status, 200);
      assert(
        assetUploadResponseSchema.parse(await response.json()).path.startsWith(
          scenario.prefix,
        ),
      );
      if (scenario.query.kind === "event_banner") {
        assert(
          calls.findIndex((call) => call.url.pathname === "/rest/v1/events") <
            calls.findIndex((call) =>
              call.url.pathname.endsWith("/consume_rate_limit")
            ),
        );
      }
    });
  }
});
Deno.test("assets refuse foreign org, missing/unknown membership and foreign event before quota or binary read", async () => {
  for (
    const scenario of [
      { options: {}, query: { orgId: orgB, kind: "logo" } },
      { options: { role: null }, query: { orgId: orgA, kind: "logo" } },
      { options: { role: "unknown" }, query: { orgId: orgA, kind: "logo" } },
      {
        options: {},
        query: { orgId: orgA, kind: "event_banner", eventId: eventB },
      },
    ]
  ) {
    await withFixture(scenario.options, async (calls) => {
      const req = upload(scenario.query);
      const response = await handleOrganizationAssetsRequest(req);
      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: "FORBIDDEN" });
      assertEquals(quotaCalls(calls).length, 0);
      assertEquals(storageCalls(calls).length, 0);
      assertEquals(req.bodyUsed, false);
    });
  }
});
Deno.test("asset upload query rejects arbitrary paths, identifiers, event mismatch and duplicate keys", async () => {
  for (
    const query of [
      { orgId: orgA, kind: "logo", path: `orgs/${orgB}/logo/forged.png` },
      { orgId: orgA, kind: "logo", assetId },
      { orgId: orgA, kind: "logo", userId: actorId },
      { orgId: orgA, kind: "logo", eventId: eventA },
      { orgId: orgA, kind: "event_banner" },
      { orgId: orgA, kind: "invalid" },
    ]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationAssetsRequest(upload(query));
      assertEquals(response.status, 400);
      assertEquals(await response.json(), { error: "VALIDATION_ERROR" });
      assertEquals(calls.length, 1);
    });
  }
  await withFixture({}, async (calls) => {
    const req = new Request(
      `https://edge.test/organizations/assets/upload?orgId=${orgA}&kind=logo&orgId=${orgB}`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer fixture-user",
          "content-type": "image/png",
        },
        body: png,
      },
    );
    const response = await handleOrganizationAssetsRequest(req);
    assertEquals(response.status, 400);
    assertEquals(calls.length, 1);
  });
});
Deno.test("asset upload rejects SVG/HTML, mismatched MIME, truncated containers and polyglot suffixes", async () => {
  const encoder = new TextEncoder();
  const suffixed = new Uint8Array(png.length + 7);
  suffixed.set(png);
  suffixed.set(encoder.encode("<html/>"), png.length);
  const badCrc = png.slice();
  badCrc[badCrc.length - 1] ^= 1;
  const scenarios = [
    {
      body: encoder.encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
      mime: "image/svg+xml",
      status: 415,
    },
    {
      body: encoder.encode("<html><script>alert(1)</script></html>"),
      mime: "image/png",
      status: 400,
    },
    { body: png, mime: "image/jpeg", status: 400 },
    { body: png.subarray(0, 24), mime: "image/png", status: 400 },
    { body: badCrc, mime: "image/png", status: 400 },
    { body: suffixed, mime: "image/png", status: 400 },
    ...imageFixtures.slice(1).map((f) => ({
      body: decode(f.base64).subarray(0, 24),
      mime: f.mime,
      status: 400,
    })),
  ];
  for (const scenario of scenarios) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationAssetsRequest(
        upload(undefined, scenario.body, scenario.mime),
      );
      assertEquals(response.status, scenario.status);
      assertEquals(await response.json(), {
        error: scenario.status === 415
          ? "ASSET_TYPE_NOT_ALLOWED"
          : "ASSET_CONTENT_INVALID",
      });
      assertEquals(storageCalls(calls).length, 0);
    });
  }
});
Deno.test("asset streaming enforces five MiB even with absent or forged content length and cancels reader", async () => {
  for (const headers of [{}, { "content-length": "1" }]) {
    await withFixture({}, async (calls) => {
      let cancelled = false;
      let count = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024));
          count++;
          if (count === 7) controller.close();
        },
        cancel() {
          cancelled = true;
        },
      });
      const req = upload(undefined, stream, "image/png", true, headers);
      const response = await handleOrganizationAssetsRequest(req);
      assertEquals(response.status, 413);
      assertEquals(await response.json(), { error: "PAYLOAD_TOO_LARGE" });
      assert(cancelled);
      assertEquals(storageCalls(calls).length, 0);
    });
  }
  await withFixture({}, async (calls) => {
    const req = upload(undefined, png, "image/png", true, {
      "content-length": String(MAX_ASSET_BYTES + 1),
    });
    const response = await handleOrganizationAssetsRequest(req);
    assertEquals(response.status, 413);
    assertEquals(req.bodyUsed, false);
    assertEquals(storageCalls(calls).length, 0);
  });
});
Deno.test("asset deletion derives the same org and resource prefix and excludes arbitrary path payloads", async () => {
  for (
    const scenario of [{ kind: "logo", prefix: `orgs/${orgA}/logo/` }, {
      kind: "default_banner",
      prefix: `orgs/${orgA}/default_banner/`,
    }, {
      kind: "event_banner",
      eventId: eventA,
      prefix: `orgs/${orgA}/events/${eventA}/banner/`,
    }]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationAssetsRequest(
        deletion({
          orgId: orgA,
          kind: scenario.kind,
          ...(scenario.eventId ? { eventId: scenario.eventId } : {}),
          assetId,
          extension: "png",
        }),
      );
      assertEquals(response.status, 200);
      assertEquals(await response.json(), { success: true });
      assertEquals(storageCalls(calls)[0].method, "DELETE");
      assertEquals(storageCalls(calls)[0].body, {
        prefixes: [`${scenario.prefix}${assetId}.png`],
      });
    });
  }
  for (
    const scenario of [
      {
        body: { orgId: orgB, kind: "logo", assetId, extension: "png" },
        status: 403,
      },
      {
        body: {
          orgId: orgA,
          kind: "event_banner",
          eventId: eventB,
          assetId,
          extension: "png",
        },
        status: 403,
      },
      {
        body: {
          orgId: orgA,
          kind: "logo",
          assetId,
          extension: "png",
          path: "defaults/default_logo.webp",
        },
        status: 400,
      },
      {
        body: { orgId: orgA, kind: "logo", assetId, extension: "svg" },
        status: 400,
      },
    ]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationAssetsRequest(
        deletion(scenario.body),
      );
      assertEquals(response.status, scenario.status);
      assertEquals(quotaCalls(calls).length, 0);
      assertEquals(storageCalls(calls).length, 0);
    });
  }
});
Deno.test("asset quotas deny upload and delete before content or Storage work", async () => {
  for (const quota of ["denied", "unavailable"] satisfies Options["quota"][]) {
    for (const kind of ["upload", "delete"]) {
      await withFixture({ quota }, async (calls) => {
        const req = kind === "upload"
          ? upload()
          : deletion({ orgId: orgA, kind: "logo", assetId, extension: "png" });
        const response = await handleOrganizationAssetsRequest(req);
        assertEquals(response.status, quota === "denied" ? 429 : 503);
        assertEquals(
          response.headers.get("retry-after"),
          quota === "denied" ? "17" : "30",
        );
        assertEquals(storageCalls(calls).length, 0);
        if (kind === "upload") {
          assertEquals(req.bodyUsed, false);
        }
      });
    }
  }
});
Deno.test("asset errors hide Storage/resource details and exact route rejects lookalikes", async () => {
  for (const kind of ["upload", "delete"]) {
    await withFixture({ storageError: true }, async () => {
      const response = await handleOrganizationAssetsRequest(
        kind === "upload"
          ? upload()
          : deletion({ orgId: orgA, kind: "logo", assetId, extension: "png" }),
      );
      assertEquals(response.status, 500);
      assertEquals(await response.json(), {
        error: kind === "upload"
          ? "ASSET_UPLOAD_FAILED"
          : "ASSET_DELETE_FAILED",
      });
    });
  }
  await withFixture({ eventError: true }, async (calls) => {
    const response = await handleOrganizationAssetsRequest(
      upload({ orgId: orgA, kind: "event_banner", eventId: eventA }),
    );
    assertEquals(response.status, 500);
    assertEquals(await response.json(), {
      error: "ASSET_RESOURCE_LOAD_FAILED",
    });
    assertEquals(quotaCalls(calls).length, 0);
  });
  await withFixture({}, async (calls) => {
    const response = await handleOrganizationAssetsRequest(
      new Request(
        `https://edge.test/other/organizations/assets/upload?orgId=${orgA}&kind=logo`,
        {
          method: "POST",
          headers: { authorization: "Bearer fixture-user" },
          body: png,
        },
      ),
    );
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "UNKNOWN_ROUTE" });
    assertEquals(calls.length, 1);
  });
});
