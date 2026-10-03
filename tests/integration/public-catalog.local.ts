import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleEventsRequest } from "../../supabase/functions/events/index.ts";
import {
  publicEventDetailSchema,
  publicEventShareSchema,
  publicEventsPageSchema,
  publicOrgBySlugSchema,
  publicSalesTermsSchema,
} from "../../shared/schemas/public-catalog.ts";
import { hashRateLimitKey } from "../../supabase/functions/_shared/modules/supabase-rate-limit/hash-key.ts";
function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
Deno.test("B5 real public HTTP/PostgREST and bundled Netlify: published scope, paging, quota, no RLS/direct RPC", async () => {
  const base = env("SUPABASE_URL");
  assertEquals(new URL(base).hostname, "127.0.0.1");
  const service = createClient(base, env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(base, env("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, handleEventsRequest);
  const origin =
    `http://127.0.0.1:${server.addr.port}/functions/v1/events/public`;
  async function call(
    route: string,
    body: unknown,
    token: string | null = null,
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
    const families = [
      { route: "org", body: { orgSlug: "b5-a" } },
      { route: "overview", body: { orgSlug: "b5-a" } },
      { route: "detail", body: { orgSlug: "b5-a", eventSlug: "event-101" } },
      { route: "sales-terms", body: { orgSlug: "b5-a" } },
      { route: "share", body: { orgSlug: "b5-a", eventSlug: "event-101" } },
    ];
    for (const f of families) {
      await call(f.route, f.body);
      await call(f.route, f.body, "invalid-session");
      await call(f.route, { ...f.body, orgId: crypto.randomUUID() }, null, 400);
      await call(
        f.route,
        {
          ...f.body,
          orgSlug: "b5-hidden",
          ...("eventSlug" in f.body ? { eventSlug: "b5-hidden" } : {}),
        },
        null,
        404,
      );
      await call(f.route, { ...f.body, orgSlug: "missing-org" }, null, 404);
    }
    const org = publicOrgBySlugSchema.parse(
      await call("org", { orgSlug: "b5-a" }),
    );
    assertEquals(org.org.name, "B5 Public A");
    assert(!JSON.stringify(org).includes("stripe"));
    assert(!JSON.stringify(org).includes("dixirvll"));
    const ids = new Set<string>();
    let after: string | null = null;
    do {
      const page = publicEventsPageSchema.parse(
        await call("overview", { orgSlug: "b5-a", limit: 37, after }),
      );
      for (const event of page.events) {
        assert(!ids.has(event.id));
        ids.add(event.id);
        assert(!event.slug.includes("draft"));
      }
      after = page.nextCursor;
    } while (after);
    assertEquals(ids.size, 205);
    await call(
      "overview",
      { orgSlug: "b5-a", after: "b5000000-0000-4000-8000-000000000402" },
      null,
      403,
    );
    await call("overview", { orgSlug: "b5-a", limit: 101 }, null, 400);
    const detail = publicEventDetailSchema.parse(
      await call("detail", { orgSlug: "b5-a", eventSlug: "event-101" }),
    );
    assertEquals(detail.formFields[0].options, [{
      label: "Preserved",
      value: "Mixed_Case_Key",
    }]);
    assertEquals(
      detail.event.bannerUrl,
      `${base}/storage/v1/object/public/public-assets/defaults/default_banner.webp`,
    );
    assert(!JSON.stringify(detail).includes("connectTermsAcceptedVersion"));
    assert(!JSON.stringify(detail).includes("createdBy"));
    publicSalesTermsSchema.parse(
      await call("sales-terms", { orgSlug: "b5-a" }),
    );
    publicEventShareSchema.parse(
      await call("share", { orgSlug: "b5-a", eventSlug: "event-101" }),
    );
    for (const route of ["detail", "share"]) {
      await call(route, { orgSlug: "b5-a", eventSlug: "b5-draft" }, null, 404);
      await call(
        route,
        { orgSlug: "b5-a", eventSlug: "b5-foreign" },
        null,
        404,
      );
    }
    publicEventDetailSchema.parse(
      await call("detail", { orgSlug: "b5-b", eventSlug: "b5-foreign" }),
    );
    // Real Node20-compatible Netlify bundle consumes this real Edge dispatcher.
    const child = new Deno.Command("node", {
      args: ["tests/integration/share-b5.local.cjs"],
      env: {
        VITE_SUPABASE_URL: `http://127.0.0.1:${server.addr.port}`,
        VITE_SUPABASE_ANON_KEY: env("SUPABASE_ANON_KEY"),
        PUBLIC_BASE_URL: "https://public-fixture.invalid",
      },
      stdout: "piped",
      stderr: "piped",
    });
    const node = await child.output();
    assertEquals(node.code, 0, new TextDecoder().decode(node.stderr));
    const cache = await fetch(`${origin}/org`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgSlug: "b5-a" }),
    });
    assertEquals(cache.headers.get("cache-control"), "no-store");
    await cache.body?.cancel();
    for (
      const [name, args] of [["get_public_org_by_slug", { p_slug: "b5-a" }], [
        "get_public_org_events_overview",
        { p_org_slug: "b5-a" },
      ], ["get_public_event_detail", {
        p_org_slug: "b5-a",
        p_event_slug: "event-101",
      }], ["get_public_organization_sales_terms", {
        p_org_slug: "b5-a",
      }]] as const
    ) assertEquals((await anon.rpc(name, args)).error?.code, "42501");
    for (
      const table of [
        "events",
        "organization_profile",
        "organizations",
        "event_products",
        "event_form_fields",
        "event_form_field_groups",
      ]
    ) {
      assertEquals(
        (await anon.from(table).select("*").limit(1)).error?.code,
        "42501",
      );
    }
    for (const f of families) {
      const key = await hashRateLimitKey(
        `org:b5000000-0000-4000-8000-000000000011:event:${
          "eventSlug" in f.body
            ? "b5000000-0000-4000-8000-000000000101"
            : "none"
        }:route:${f.route}`,
        env("RATE_LIMIT_SALT"),
      );
      for (let n = 0; n < 240; n++) {
        assert(
          !(await service.rpc("consume_rate_limit", {
            p_key_hash: key,
            p_scope: "catalog:resource:1m",
            p_limit: 240,
            p_window_seconds: 60,
          })).error,
        );
      }
      await call(f.route, f.body, null, 429);
    }
    publicOrgBySlugSchema.parse(await call("org", { orgSlug: "b5-b" }));
  } finally {
    await server.shutdown();
  }
});
