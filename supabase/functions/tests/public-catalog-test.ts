import { z } from "zod";
import { assert, assertEquals } from "@std/assert";
import { handleEventsRequest } from "../events/index.ts";
import { hashRateLimitKey } from "../_shared/modules/supabase-rate-limit/hash-key.ts";
const org = "b5100000-0000-4000-8000-000000000011",
  event = "b5100000-0000-4000-8000-000000000021";
const terms = {
  sellerLegalName: null,
  sellerAddress: null,
  sellerBusinessNumber: null,
  sellerType: null,
  displayName: "Public Org",
  publicEmail: "public@example.test",
  phone: null,
  website: null,
  salesTerms: "Synthetic terms. ".repeat(20),
  salesTermsVersion: "b5-v1",
  salesTermsAccepted: false,
  salesTermsAvailable: true,
  paidSalesAvailable: false,
};
const families = [
  { route: "org", body: { orgSlug: "public-org" } },
  { route: "overview", body: { orgSlug: "public-org" } },
  {
    route: "detail",
    body: { orgSlug: "public-org", eventSlug: "published-event" },
  },
  { route: "sales-terms", body: { orgSlug: "public-org" } },
  {
    route: "share",
    body: { orgSlug: "public-org", eventSlug: "published-event" },
  },
];
type Options = {
  denied?: "ingress" | "resource";
  unavailable?: boolean;
  hidden?: boolean;
  malformed?: boolean;
};
async function fixture(
  options: Options,
  run: (calls: { path: string; body: unknown }[]) => Promise<void>,
) {
  const env = {
    SUPABASE_URL: "https://b5.invalid",
    SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    RATE_LIMIT_SALT: "synthetic-b5",
    RATE_LIMIT_TRUST_CLOUDFLARE_IP: "0",
  };
  const previous = new Map(Object.keys(env).map((k) => [k, Deno.env.get(k)])),
    oldFetch = globalThis.fetch,
    calls: { path: string; body: unknown }[] = [];
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  globalThis.fetch = async (input, init) => {
    const req = new Request(input, init),
      url = new URL(req.url),
      text = await req.text(),
      body: unknown = text ? JSON.parse(text) : null;
    calls.push({ path: url.pathname, body });
    assertEquals(req.headers.get("authorization"), "Bearer synthetic-service");
    assertEquals(req.headers.get("apikey"), "synthetic-service");
    if (url.pathname.endsWith("consume_rate_limit")) {
      if (options.unavailable) {
        return Response.json({ message: "private quota" }, { status: 500 });
      }
      const value = z.object({ p_key_hash: z.string(), p_scope: z.string() })
        .parse(body);
      assertEquals(
        value.p_key_hash,
        await hashRateLimitKey(
          value.p_scope === "catalog:resource:1m"
            ? `org:${org}:event:${
              calls.some((c) => c.path === "/rest/v1/events") ? event : "none"
            }:route:${currentRoute}`
            : "shared:unresolved",
          "synthetic-b5",
        ),
      );
      return Response.json([{
        allowed: options.denied !==
          (value.p_scope === "catalog:resource:1m" ? "resource" : "ingress"),
        request_count: 1,
        retry_after_seconds: 19,
      }]);
    }
    if (url.pathname === "/rest/v1/organization_profile") {
      assertEquals(url.searchParams.get("select"), "org_id");
      assertEquals(url.searchParams.get("slug"), "eq.public-org");
      return Response.json({ org_id: org });
    }
    if (url.pathname === "/rest/v1/organizations") {
      assertEquals(url.searchParams.get("id"), `eq.${org}`);
      assertEquals(url.searchParams.get("status"), "eq.active");
      return Response.json(options.hidden ? null : { id: org });
    }
    if (url.pathname === "/rest/v1/events") {
      assertEquals(url.searchParams.get("org_id"), `eq.${org}`);
      assertEquals(url.searchParams.get("is_published"), "eq.true");
      return Response.json({ id: event });
    }
    if (options.malformed) {
      return Response.json({ privateSnapshot: "never show" });
    }
    if (url.pathname.endsWith("catalog_get_public_org_by_slug")) {
      return Response.json({
        org: { id: org, type: "association", name: "Public Org" },
        profile: {
          slug: "public-org",
          displayName: "Public Org",
          description: null,
          publicEmail: "public@example.test",
          phone: null,
          website: null,
          logoUrl: null,
          primaryColor: null,
          defaultEventBannerUrl: null,
        },
      });
    }
    if (url.pathname.endsWith("catalog_get_public_org_events_overview")) {
      return Response.json({
        orgSlug: "public-org",
        events: [],
        nextCursor: null,
      });
    }
    if (url.pathname.endsWith("catalog_get_public_organization_sales_terms")) {
      return Response.json(terms);
    }
    if (url.pathname.endsWith("catalog_get_public_event_detail")) {
      return Response.json({
        org: {
          slug: "public-org",
          defaultEventBannerUrl: null,
          logoUrl: null,
          primaryColor: null,
        },
        event: { id: event, slug: "published-event", title: "Public Event" },
        products: [],
        formFields: [],
        formFieldsGroups: [],
      });
    }
    if (url.pathname.endsWith("catalog_event_share")) {
      return Response.json({
        orgName: "Public Org",
        orgDescription: null,
        eventTitle: "Public Event",
        eventDescription: null,
        bannerUrl: null,
      });
    }
    throw new Error("Unexpected public dependency");
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
let currentRoute = "org";
function call(route: string, body: unknown) {
  currentRoute = route;
  return handleEventsRequest(
    new Request(`https://edge.invalid/functions/v1/events/public/${route}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer invalid-client-jwt",
        "cf-connecting-ip": "1.2.3.4",
        "x-forwarded-for": "5.6.7.8",
      },
      body: JSON.stringify(body),
    }),
  );
}
for (const f of families) {
  Deno.test(`B5 public ${f.route}: anonymous capability, service identity, publication, quotas, DTO and strict payload`, async () => {
    await fixture({}, async () => {
      const r = await call(f.route, f.body);
      assertEquals(r.status, 200);
      assertEquals(r.headers.get("cache-control"), "no-store");
    });
    for (const denied of ["ingress", "resource"] as const) {
      await fixture({ denied }, async (calls) => {
        const r = await call(f.route, f.body);
        assertEquals(r.status, 429);
        assertEquals(r.headers.get("retry-after"), "19");
        assert(
          !calls.some((c) => c.path.includes("/rpc/catalog_")),
        );
        if (denied === "ingress") {
          assert(
            !calls.some((c) => c.path === "/rest/v1/organization_profile"),
          );
        }
      });
    }
    await fixture({ unavailable: true }, async (calls) => {
      assertEquals((await call(f.route, f.body)).status, 503);
      assertEquals(calls.length, 1);
    });
    await fixture({ hidden: true }, async (calls) => {
      assertEquals((await call(f.route, f.body)).status, 404);
      assert(!calls.some((c) => c.path.includes("/rpc/catalog_")));
    });
    await fixture({}, async (calls) => {
      assertEquals(
        (await call(f.route, { ...f.body, isPublished: true })).status,
        400,
      );
      assert(!calls.some((c) => c.path.includes("/rpc/catalog_")));
    });
    await fixture({ malformed: true }, async () => {
      const r = await call(f.route, f.body);
      assertEquals(r.status, 500);
      assertEquals(await r.json(), { error: "UNEXPECTED_ERROR" });
    });
  });
}
