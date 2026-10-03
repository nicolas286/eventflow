import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { makePublicOrgRepo } from "../../../src/app/modules/public/organization/data/makePublicOrgRepo";
import { makePublicEventsOverviewRepo } from "../../../src/app/modules/public/organization/data/makePublicEventsOverviewRepo";
import { makePublicEventDetailRepo } from "../../../src/app/modules/public/events/data/makePublicEventDetailRepo";
import { handler } from "../../../netlify/functions/share-event.js";
const id = "b5200000-0000-4000-8000-000000000001",
  next = "b5200000-0000-4000-8000-000000000002";
function fixture() {
  const client = createClient("https://b5.invalid", "synthetic", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const functions = client.functions;
  vi.spyOn(client, "functions", "get").mockReturnValue(functions);
  return {
    client,
    invoke: vi.spyOn(functions, "invoke"),
    rpc: vi.spyOn(client, "rpc"),
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("assembles all public event pages with exact Edge cursor and original API", async () => {
  const f = fixture();
  f.invoke
    .mockResolvedValueOnce({
      data: {
        orgSlug: "public-org",
        events: [{ id, slug: "event-one", title: "Event One" }],
        nextCursor: id,
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        orgSlug: "public-org",
        events: [{ id: next, slug: "event-two", title: "Event Two" }],
        nextCursor: null,
      },
      error: null,
    });
  const result = await makePublicEventsOverviewRepo(
    f.client,
  ).getPublicOrgEventsOverview("public-org");
  expect(result.events.map((e) => e.id)).toEqual([id, next]);
  expect(f.invoke).toHaveBeenLastCalledWith("events/public/overview", {
    body: { orgSlug: "public-org", limit: 100, after: id },
  });
  expect(f.rpc).not.toHaveBeenCalled();
});
it("rejects duplicate pages and mismatched public scopes", async () => {
  const f = fixture();
  f.invoke.mockResolvedValue({
    data: {
      orgSlug: "public-org",
      events: [{ id, slug: "event-one", title: "Event One" }],
      nextCursor: id,
    },
    error: null,
  });
  await expect(
    makePublicEventsOverviewRepo(f.client).getPublicOrgEventsOverview(
      "public-org",
    ),
  ).rejects.toThrow("CATALOG_CURSOR_INVALID");
  f.invoke.mockResolvedValue({
    data: { orgSlug: "foreign", events: [], nextCursor: null },
    error: null,
  });
  await expect(
    makePublicEventsOverviewRepo(f.client).getPublicOrgEventsOverview(
      "public-org",
    ),
  ).rejects.toThrow("CATALOG_SCOPE_INVALID");
});
it.each([403, 404, 429, 503])(
  "public repositories propagate Edge %i with no direct fallback",
  async (status) => {
    const f = fixture();
    f.invoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "safe",
        context: new Response(JSON.stringify({ error: "NOT_FOUND" }), {
          status,
        }),
      },
    });
    await expect(
      makePublicOrgRepo(f.client).getPublicOrgBySlug("public-org"),
    ).rejects.toThrow();
    await expect(
      makePublicEventDetailRepo(f.client).getPublicEventDetail(
        "public-org",
        "event-one",
      ),
    ).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  },
);
function shareFixture() {
  vi.stubEnv("PUBLIC_BASE_URL", "https://frontend.invalid");
  vi.stubEnv("VITE_SUPABASE_URL", "https://b5.invalid");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "synthetic-public");
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
it("Netlify uses only the shared public Edge contract and escapes metadata", async () => {
  const fetch = shareFixture();
  fetch.mockResolvedValue(
    Response.json({
      orgName: "Org <script>",
      orgDescription: null,
      eventTitle: 'Title & "quote"',
      eventDescription: '<img onerror="evil">',
      bannerUrl: 'https://assets.invalid/x?x="bad"',
    }),
  );
  const result = await handler({
    path: "/share/o/public-org/e/event-one",
    headers: { "user-agent": "facebot" },
  });
  expect(result.statusCode).toBe(200);
  expect(result.body).toContain("Org &lt;script&gt;");
  expect(result.body).toContain("Title &amp; &quot;quote&quot;");
  expect(result.body).not.toContain("<img onerror");
  expect(result.body).not.toContain("window.location.replace");
  expect(fetch).toHaveBeenCalledWith(
    "https://b5.invalid/functions/v1/events/public/share",
    expect.objectContaining({
      method: "POST",
      headers: {
        apikey: "synthetic-public",
        "content-type": "application/json",
      },
      body: JSON.stringify({ orgSlug: "public-org", eventSlug: "event-one" }),
    }),
  );
});
it("Netlify preserves redirect, refuses malformed DTO, and propagates quota retry", async () => {
  const fetch = shareFixture();
  fetch.mockResolvedValueOnce(
    Response.json({
      orgName: "Public Org",
      orgDescription: null,
      eventTitle: "Event One",
      eventDescription: null,
      bannerUrl: null,
    }),
  );
  const good = await handler({
    path: "/share/o/public-org/e/event-one",
    headers: {},
  });
  expect(good.body).toContain("window.location.replace");
  expect(good.headers?.["cache-control"]).toContain("no-store");
  fetch.mockResolvedValueOnce(
    new Response("denied", { status: 429, headers: { "retry-after": "19" } }),
  );
  const limited = await handler({
    path: "/share/o/public-org/e/event-one",
    headers: {},
  });
  expect(limited.statusCode).toBe(429);
  expect(limited.headers?.["retry-after"]).toBe("19");
  fetch.mockResolvedValueOnce(
    Response.json({ privateSnapshot: "never render" }),
  );
  const malformed = await handler({
    path: "/share/o/public-org/e/event-one",
    headers: {},
  });
  expect(malformed.statusCode).toBe(500);
  expect(malformed.body).not.toContain("never render");
  expect(
    (await handler({ path: "/share/o/%ZZ/e/event-one", headers: {} }))
      .statusCode,
  ).toBe(400);
});

it("preserves form option values and rejects a detail from another slug", async () => {
  const f = fixture();
  const detail = {
    org: {
      slug: "public-org",
      displayName: "Public Org",
      defaultEventBannerUrl: null,
      logoUrl: null,
      primaryColor: null,
      publicEmail: "public@example.test",
      phone: null,
      website: null,
      salesTerms: "Synthetic terms. ".repeat(20),
      salesTermsVersion: "b5-v1",
      salesTermsAccepted: false,
      paidSalesAvailable: false,
    },
    event: { id, slug: "event-one", title: "Event One" },
    products: [],
    formFields: [
      {
        id,
        label: "Choose option",
        fieldKey: "answer_field",
        fieldType: "select",
        isRequired: false,
        sortOrder: 0,
        groupId: null,
        options: [{ label: "Original_Name", value: "Mixed_Case_Value" }],
      },
    ],
    formFieldsGroups: [],
  };
  f.invoke.mockResolvedValue({ data: detail, error: null });
  const value = await makePublicEventDetailRepo(f.client).getPublicEventDetail(
    "public-org",
    "event-one",
  );
  expect(value.formFields[0].options).toEqual(detail.formFields[0].options);
  f.invoke.mockResolvedValue({
    data: { ...detail, event: { ...detail.event, slug: "foreign-event" } },
    error: null,
  });
  await expect(
    makePublicEventDetailRepo(f.client).getPublicEventDetail(
      "public-org",
      "event-one",
    ),
  ).rejects.toThrow("CATALOG_SCOPE_INVALID");
  expect(f.rpc).not.toHaveBeenCalled();
});
