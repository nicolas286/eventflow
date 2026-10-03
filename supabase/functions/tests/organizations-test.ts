import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { dashboardBootstrapSchema } from "../../../shared/schemas/organizations.ts";
import { handleOrganizationsRequest } from "../organizations/index.ts";

const orgA = "b1100000-0000-4000-8000-000000000011";
const orgB = "b1100000-0000-4000-8000-000000000012";
const actorId = "b1100000-0000-4000-8000-000000000001";
const foreignActor = "b1100000-0000-4000-8000-000000000002";
const timestamp = "2026-10-01T12:00:00.000Z";
const profile = {
  user_id: actorId,
  first_name: "Alice",
  last_name: "Fixture",
  stripe_connect_allowed: false,
  created_at: timestamp,
  updated_at: timestamp,
  platform_role: "private-platform-role",
  secret: "never-return",
};
const limits = {
  plan: "free",
  max_events_per_year: 2,
  max_registrations_per_event: 100,
  max_products_per_event: 2,
  max_form_fields: 5,
  max_admins: 1,
  branding_required: true,
  custom_domain_allowed: false,
  api_access: false,
  advanced_analytics: false,
  promo_codes: false,
  automated_emails: false,
};
const organization = {
  id: orgA,
  type: "association",
  name: "Fixture Organization",
  status: "active",
  created_at: timestamp,
  created_by: actorId,
  payments_provider: "bank_transfer",
  payments_status: "not_connected",
  payments_live_ready: false,
  plan: "free",
  plan_started_at: timestamp,
  plan_expires_at: null,
  bank_transfer_iban: "BE68 5390 0754 7034",
  mollie_access_token: "never-return",
};
const organizationProfile = {
  org_id: orgA,
  slug: "fixture-organization",
  display_name: "Fixture Organization",
  description: null,
  public_email: null,
  phone: null,
  website: null,
  logo_url: null,
  primary_color: "#123456",
  default_event_banner_url: null,
  email_reminder_days_before: null,
  created_at: timestamp,
  updated_at: timestamp,
  private_contract_reference: "never-return",
};
const updateResponse = {
  orgId: orgA,
  type: "association",
  name: "Renamed Organization",
  status: "active",
  paymentStatus: "not_connected",
  paymentsLiveReady: false,
  profile: {
    slug: "renamed-organization",
    displayName: "Renamed Organization",
    description: null,
    publicEmail: null,
    phone: null,
    website: null,
    emailReminderDaysBefore: null,
  },
};
const seller = {
  orgId: orgA,
  legalName: "Fixture Seller",
  address: "Rue Exemple 10, Namur",
  businessNumber: null,
  sellerType: "non_professional",
  phone: "+3200000000",
};
const agreements = {
  orgId: orgA,
  connectVersion: "2026-10-01",
  dpaVersion: "2026-10-01",
  platformTermsVersion: "2026-10-01",
  privacyVersion: "2026-10-01",
};
type Membership = {
  org_id: string;
  user_id: string;
  role: string;
  created_at: string;
};
type CapturedRequest = {
  url: URL;
  headers: Headers;
  body: unknown;
  method: string;
};
type Options = {
  authError?: boolean;
  role?: string | null;
  memberships?: Membership[];
  quota?: "denied" | "unavailable";
  databaseError?: { message: string; code?: string };
};
const orgAMembership = {
  org_id: orgA,
  user_id: actorId,
  role: "admin",
  created_at: timestamp,
};

async function withFixture(
  options: Options,
  run: (calls: CapturedRequest[]) => Promise<void>,
) {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://organizations-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: "fixture-organizations-salt",
  };
  const previousEnv = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  const previousFetch = globalThis.fetch;
  const calls: CapturedRequest[] = [];
  const memberships = options.memberships ??
    (options.role === null
      ? []
      : [{ ...orgAMembership, role: options.role ?? "admin" }]);
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
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
        user_metadata: {
          userId: foreignActor,
          orgId: orgB,
          role: "owner",
          stripeConnectAllowed: true,
        },
      });
    }
    assertEquals(
      outbound.headers.get("authorization"),
      "Bearer fixture-service",
    );
    assertEquals(outbound.headers.get("apikey"), "fixture-service");
    if (url.pathname === "/rest/v1/organization_members") {
      assertEquals(url.searchParams.get("user_id"), `eq.${actorId}`);
      const scoped = url.searchParams.get("org_id");
      const matching = memberships.filter((m) =>
        !scoped || scoped.toLowerCase() === `eq.${m.org_id.toLowerCase()}`
      ).sort((a, b) => a.created_at.localeCompare(b.created_at));
      if (url.searchParams.get("select") === "role") {
        assert(scoped);
        return Response.json(
          matching.length ? { role: matching[0].role } : null,
        );
      }
      assertEquals(url.searchParams.get("order"), "created_at.asc");
      assertEquals(url.searchParams.get("limit"), "1");
      return Response.json(matching[0] ?? null);
    }
    if (url.pathname === "/rest/v1/rpc/consume_rate_limit") {
      if (options.quota === "unavailable") {
        return Response.json({ message: "private-database-detail" }, {
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
      const args = z.object({ p_actor_id: z.string() }).parse(body);
      assertEquals(args.p_actor_id, actorId);
      if (url.pathname.endsWith("/organizer_create_organization")) {
        return Response.json(orgA);
      }
      if (url.pathname.endsWith("/organizer_update_organization")) {
        return Response.json(updateResponse);
      }
      return Response.json({ success: true, private_evidence: "never-return" });
    }
    if (url.pathname === "/rest/v1/user_profile") {
      assertEquals(url.searchParams.get("user_id"), `eq.${actorId}`);
      const patch = outbound.method === "PATCH"
        ? z.record(z.string(), z.unknown()).parse(body)
        : {};
      return Response.json({ ...profile, ...patch });
    }
    if (url.pathname === "/rest/v1/plan_limits") {
      assertEquals(url.searchParams.get("plan"), "eq.free");
      return Response.json(limits);
    }
    const orgFilter = url.searchParams.get(
      url.pathname === "/rest/v1/organizations" ? "id" : "org_id",
    );
    assert(orgFilter);
    assert(memberships.some((m) => orgFilter === `eq.${m.org_id}`));
    const selectedOrg = orgFilter.slice(3);
    if (url.pathname === "/rest/v1/organizations") {
      return Response.json({ ...organization, id: selectedOrg });
    }
    if (url.pathname === "/rest/v1/organization_profile") {
      const patch = outbound.method === "PATCH"
        ? z.record(z.string(), z.unknown()).parse(body)
        : {};
      return Response.json({
        ...organizationProfile,
        org_id: selectedOrg,
        ...patch,
      });
    }
    if (url.pathname === "/rest/v1/subscriptions") {
      return Response.json({
        org_id: selectedOrg,
        provider: "manual",
        status: "active",
        current_period_end: null,
        plan: "free",
        mollie_customer_id: "never-return",
        mollie_subscription_id: "never-return",
      });
    }
    if (url.pathname === "/rest/v1/invoices") {
      assertEquals(url.searchParams.get("provider"), "eq.manual");
      assertEquals(url.searchParams.get("status"), "eq.issued");
      assertEquals(url.searchParams.get("limit"), "1");
      return Response.json({
        id: "b1100000-0000-4000-8000-000000000031",
        number: "FIXTURE-001",
        status: "issued",
        issued_at: timestamp,
        due_at: timestamp,
        total_cents: 100,
        currency: "EUR",
        payment_reference: "FIXTURE",
        billing_snapshot: "never-return",
        pdf_path: "never-return",
      });
    }
    throw new Error(`Unexpected fixture route: ${url.pathname}`);
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
function request(route: string, body: unknown, authenticated = true) {
  return rawRequest(route, JSON.stringify(body), authenticated);
}
function rawRequest(route: string, body: string, authenticated = true) {
  return new Request(`https://edge.test/organizations/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer fixture-user" } : {}),
    },
    body,
  });
}
function mutations(calls: CapturedRequest[]) {
  return calls.filter((call) =>
    call.url.pathname.startsWith("/rest/v1/rpc/organizer_") ||
    call.method === "PATCH"
  );
}
function quotaCalls(calls: CapturedRequest[]) {
  return calls.filter((call) =>
    call.url.pathname.endsWith("/consume_rate_limit")
  );
}

Deno.test("organizations reject absent and invalid sessions before business reads", async () => {
  for (
    const scenario of [{ authError: false, authenticated: false }, {
      authError: true,
      authenticated: true,
    }]
  ) {
    await withFixture({ authError: scenario.authError }, async (calls) => {
      const response = await handleOrganizationsRequest(
        request("bootstrap", {}, scenario.authenticated),
      );
      assertEquals(response.status, 401);
      assertEquals(await response.json(), { error: "UNAUTHORIZED" });
      assertEquals(calls.length, scenario.authenticated ? 1 : 0);
    });
  }
});

Deno.test("organization create passes the verified actor and ignores privilege metadata", () =>
  withFixture({}, async (calls) => {
    const response = await handleOrganizationsRequest(
      request("create", { type: "association", name: "Fixture Organization" }),
    );
    assertEquals(response.status, 200);
    assertEquals(await response.json(), orgA);
    assertEquals(mutations(calls)[0].body, {
      p_actor_id: actorId,
      p_input: { type: "association", name: "Fixture Organization" },
    });
    assertEquals(calls.map((call) => call.url.pathname), [
      "/auth/v1/user",
      "/rest/v1/rpc/consume_rate_limit",
      "/rest/v1/rpc/organizer_create_organization",
    ]);
  }));

Deno.test("organization UUID casing cannot select a fresh quota bucket", async () => {
  await withFixture({ quota: "denied" }, async (calls) => {
    for (const orgId of [orgA, orgA.toUpperCase()]) {
      const response = await handleOrganizationsRequest(
        request("update", { orgId, name: "Renamed Organization" }),
      );
      assertEquals(response.status, 429);
    }
    const quotaCalls = calls.filter((call) =>
      call.url.pathname === "/rest/v1/rpc/consume_rate_limit"
    );
    assertEquals(quotaCalls.length, 2);
    assertEquals(quotaCalls[0].body, quotaCalls[1].body);
    assertEquals(mutations(calls).length, 0);
  });
});

Deno.test("organization update scopes owner and admin before quota and uses an explicit patch", async () => {
  for (const role of ["owner", "admin"]) {
    await withFixture({ role }, async (calls) => {
      const response = await handleOrganizationsRequest(
        request("update", {
          orgId: orgA,
          name: "Renamed Organization",
        }),
      );
      assertEquals(response.status, 200);
      assertEquals(await response.json(), updateResponse);
      assertEquals(mutations(calls)[0].body, {
        p_actor_id: actorId,
        p_input: {
          org_id: orgA,
          name: "Renamed Organization",
        },
      });
      assertEquals(
        calls.map((call) => call.url.pathname),
        [
          "/auth/v1/user",
          "/rest/v1/organization_members",
          "/rest/v1/rpc/consume_rate_limit",
          "/rest/v1/rpc/organizer_update_organization",
        ],
      );
    });
  }
});

Deno.test("every organization resource mutation refuses foreign org or missing/unknown membership before quota", async () => {
  const scenarios = [
    { route: "update", body: { orgId: orgB, name: "Foreign Organization" } },
    {
      route: "branding",
      body: { orgId: orgB, patch: { primaryColor: "#123456" } },
    },
    { route: "seller-identity", body: { ...seller, orgId: orgB } },
    { route: "agreements", body: { ...agreements, orgId: orgB } },
    { route: "bootstrap", body: { orgId: orgB } },
  ];
  for (const scenario of scenarios) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: "FORBIDDEN" });
      assertEquals(mutations(calls).length, 0);
      assertEquals(quotaCalls(calls).length, 0);
    });
  }
  for (const role of [null, "unexpected-role"]) {
    await withFixture({ role }, async (calls) => {
      const response = await handleOrganizationsRequest(
        request("update", { orgId: orgA, name: "Renamed Organization" }),
      );
      assertEquals(response.status, 403);
      assertEquals(quotaCalls(calls).length, 0);
      assertEquals(mutations(calls).length, 0);
    });
  }
});

Deno.test("profile updates are isolated to the verified user and reject promotion fields", async () => {
  await withFixture({}, async (calls) => {
    const response = await handleOrganizationsRequest(
      request("profile", { userId: actorId, patch: { firstName: "Updated" } }),
    );
    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.firstName, "Updated");
    assertEquals(result.stripeConnectAllowed, false);
    assertEquals(mutations(calls)[0].body, { first_name: "Updated" });
    assertEquals(
      mutations(calls)[0].url.searchParams.get("user_id"),
      `eq.${actorId}`,
    );
  });
  for (
    const scenario of [
      {
        body: { userId: foreignActor, patch: { firstName: "Forged" } },
        status: 403,
      },
      {
        body: { userId: actorId, patch: { stripeConnectAllowed: true } },
        status: 400,
      },
      { body: { userId: actorId, patch: { role: "owner" } }, status: 400 },
      {
        body: { userId: actorId, patch: { userId: foreignActor } },
        status: 400,
      },
    ]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationsRequest(
        request("profile", scenario.body),
      );
      assertEquals(response.status, scenario.status);
      assertEquals(quotaCalls(calls).length, 0);
      assertEquals(mutations(calls).length, 0);
    });
  }
});

Deno.test("seller identity and agreement acceptance use verified actor with fixed legal versions", async () => {
  for (
    const scenario of [{ route: "seller-identity", body: seller }, {
      route: "agreements",
      body: agreements,
    }]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(response.status, 200);
      assertEquals(await response.json(), { success: true });
      assertEquals(
        mutations(calls)[0].body,
        scenario.route === "seller-identity"
          ? {
            p_actor_id: actorId,
            p_org_id: orgA,
            p_legal_name: seller.legalName,
            p_address: seller.address,
            p_business_number: null,
            p_seller_type: seller.sellerType,
            p_phone: seller.phone,
          }
          : {
            p_actor_id: actorId,
            p_org_id: orgA,
            p_connect_version: "2026-10-01",
            p_dpa_version: "2026-10-01",
            p_platform_terms_version: "2026-10-01",
            p_privacy_version: "2026-10-01",
          },
      );
    });
  }
});

Deno.test("organization contracts reject actor injection, payment fields, stale versions and branding audit fields", async () => {
  for (
    const scenario of [
      {
        route: "create",
        body: {
          type: "association",
          name: "Fixture Organization",
          userId: foreignActor,
        },
      },
      {
        route: "create",
        body: {
          type: "association",
          name: "Fixture Organization",
          plan: "pro",
        },
      },
      { route: "update", body: { orgId: orgA, paymentsLiveReady: true } },
      {
        route: "update",
        body: { orgId: orgA, stripeConnectedAccountId: "acct_forged" },
      },
      { route: "update", body: { orgId: orgA, status: "trial" } },
      { route: "update", body: { orgId: orgA, status: "active" } },
      { route: "update", body: { orgId: orgA, status: "suspended" } },
      { route: "seller-identity", body: { ...seller, userId: foreignActor } },
      { route: "agreements", body: { ...agreements, connectVersion: "old" } },
      {
        route: "agreements",
        body: { ...agreements, acceptedBy: foreignActor },
      },
      { route: "branding", body: { orgId: orgA, patch: { orgId: orgB } } },
      {
        route: "branding",
        body: {
          orgId: orgA,
          patch: { platformAgreementsAcceptedAt: timestamp },
        },
      },
      {
        route: "branding",
        body: { orgId: orgA, patch: { primaryColor: "invalid" } },
      },
    ]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationsRequest(
        request(scenario.route, scenario.body),
      );
      assertEquals(response.status, 400);
      assertEquals(await response.json(), { error: "VALIDATION_ERROR" });
      assertEquals(calls.length, 1);
    });
  }
});

Deno.test("branding changes use scoped columns and return only branding DTO fields", () =>
  withFixture({}, async (calls) => {
    const response = await handleOrganizationsRequest(
      request("branding", {
        orgId: orgA,
        patch: {
          primaryColor: "#abcdef",
          displayName: "New Public Name",
          widgetBg: "#123456",
        },
      }),
    );
    assertEquals(response.status, 200);
    const result = await response.json();
    assertEquals(result.primaryColor, "#abcdef");
    assertEquals(result.displayName, "New Public Name");
    assertEquals(Object.hasOwn(result, "privateContractReference"), false);
    assertEquals(Object.hasOwn(result, "salesTerms"), false);
    assertEquals(mutations(calls)[0].body, {
      primary_color: "#abcdef",
      display_name: "New Public Name",
      widget_bg: "#123456",
    });
    assertEquals(
      mutations(calls)[0].url.searchParams.get("org_id"),
      `eq.${orgA}`,
    );
  }));

Deno.test("bootstrap without organization preserves profile and free limits without org reads", () =>
  withFixture({ memberships: [] }, async (calls) => {
    const response = await handleOrganizationsRequest(request("bootstrap", {}));
    assertEquals(response.status, 200);
    const result = dashboardBootstrapSchema.parse(await response.json());
    assertEquals(result.profile.userId, actorId);
    assertEquals(result.membership, null);
    assertEquals(result.organization, null);
    assertEquals(result.organizationProfile, null);
    assertEquals(result.subscription, null);
    assertEquals(result.latestOpenInvoice, null);
    assertEquals(result.planLimits.plan, "free");
    assertEquals(
      calls.some((call) =>
        [
          "/rest/v1/organizations",
          "/rest/v1/organization_profile",
          "/rest/v1/subscriptions",
          "/rest/v1/invoices",
        ].includes(call.url.pathname)
      ),
      false,
    );
  }));

Deno.test("bootstrap selects the earliest real membership or an explicit member org and masks private DTO fields", async () => {
  const memberships = [{
    ...orgAMembership,
    created_at: "2026-10-02T12:00:00.000Z",
  }, { ...orgAMembership, org_id: orgB }];
  for (
    const scenario of [{ body: {}, expected: orgB }, {
      body: { orgId: orgA },
      expected: orgA,
    }]
  ) {
    await withFixture({ memberships }, async (calls) => {
      const response = await handleOrganizationsRequest(
        request("bootstrap", scenario.body),
      );
      assertEquals(response.status, 200);
      const raw = await response.json();
      const result = dashboardBootstrapSchema.parse(raw);
      assertEquals(result.organization?.id, scenario.expected);
      assertEquals(result.membership?.[0].orgId, scenario.expected);
      assertEquals(
        result.organization?.bankTransferIban,
        "BE•• •••• •••• 7034",
      );
      assertEquals(result.profile.firstName, "Alice");
      assertEquals(
        result.organizationProfile?.displayName,
        "Fixture Organization",
      );
      assertEquals(JSON.stringify(raw).includes("never-return"), false);
      assertEquals(JSON.stringify(raw).includes("BE68 5390 0754 7034"), false);
      const quotaIndex = calls.findIndex((call) =>
        call.url.pathname.endsWith("/consume_rate_limit")
      );
      const membershipIndex = calls.findIndex((call) =>
        call.url.pathname === "/rest/v1/organization_members" &&
        call.url.searchParams.get("select") === "role"
      );
      assert(membershipIndex >= 0 && membershipIndex < quotaIndex);
    });
  }
});

Deno.test("organization quota failures prevent every write with controlled retry responses", async () => {
  for (const quota of ["denied", "unavailable"] satisfies Options["quota"][]) {
    for (
      const scenario of [
        {
          route: "create",
          body: { type: "association", name: "Fixture Organization" },
        },
        {
          route: "update",
          body: { orgId: orgA, name: "Renamed Organization" },
        },
        {
          route: "profile",
          body: { userId: actorId, patch: { firstName: "Updated" } },
        },
        {
          route: "branding",
          body: { orgId: orgA, patch: { primaryColor: "#abcdef" } },
        },
        { route: "seller-identity", body: seller },
        { route: "agreements", body: agreements },
      ]
    ) {
      await withFixture({ quota }, async (calls) => {
        const response = await handleOrganizationsRequest(
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
        assertEquals(mutations(calls).length, 0);
      });
    }
  }
});

Deno.test("organizations bound HTTP bodies and reject malformed JSON before business operations", async () => {
  for (
    const scenario of [{ body: "{", status: 400, error: "INVALID_JSON" }, {
      body: JSON.stringify({ padding: "x".repeat(16384) }),
      status: 413,
      error: "PAYLOAD_TOO_LARGE",
    }]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationsRequest(
        rawRequest("create", scenario.body),
      );
      assertEquals(response.status, scenario.status);
      assertEquals(await response.json(), { error: scenario.error });
      assertEquals(calls.length, 1);
    });
  }
});

Deno.test("organization SQL errors map to stable codes without database detail exposure", async () => {
  for (
    const scenario of [
      {
        databaseError: { message: "VALIDATION_ERROR: private-detail" },
        status: 400,
        error: "VALIDATION_ERROR",
      },
      {
        databaseError: { message: "CONFLICT: private-detail" },
        status: 409,
        error: "CONFLICT",
      },
      {
        databaseError: { message: "NOT_FOUND" },
        status: 404,
        error: "NOT_FOUND",
      },
      {
        databaseError: { message: "private-database-detail" },
        status: 500,
        error: "ORGANIZER_OPERATION_FAILED",
      },
    ]
  ) {
    await withFixture({ databaseError: scenario.databaseError }, async () => {
      const response = await handleOrganizationsRequest(
        request("create", {
          type: "association",
          name: "Fixture Organization",
        }),
      );
      assertEquals(response.status, scenario.status);
      assertEquals(await response.json(), { error: scenario.error });
    });
  }
});
