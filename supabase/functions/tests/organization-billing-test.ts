import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { handleOrganizationsRequest } from "../organizations/index.ts";

const actorId = "b1200000-0000-4000-8000-000000000001";
const foreignActor = "b1200000-0000-4000-8000-000000000002";
const orgA = "b1200000-0000-4000-8000-000000000011";
const orgB = "b1200000-0000-4000-8000-000000000012";
const timestamp = "2026-10-03T12:00:00.000Z";
const billing = {
  orgId: orgA,
  legalName: "Fixture Company",
  vatCountryCode: "BE",
  vatNumber: "BE0123456789",
  addressLine1: "Rue Exemple 10",
  addressLine2: null,
  postalCode: "5000",
  city: "Namur",
  countryCode: "BE",
  billingEmail: "billing@example.test",
  invoiceReference: "FIXTURE",
  isVatValidated: true,
  vatValidatedAt: timestamp,
  vatValidationSource: "fixture",
  createdAt: timestamp,
  updatedAt: timestamp,
};
const billingRow = Object.fromEntries(
  Object.entries(billing).map(([key, value]) => [
    key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
    value,
  ]),
);
type Call = { url: URL; body: unknown; method: string };
type Options = {
  authError?: boolean;
  role?: string | null;
  quota?: "denied" | "unavailable";
  billingAbsent?: boolean;
  readError?: boolean;
  databaseError?: { message: string; code?: string };
};

async function withFixture(
  options: Options,
  run: (calls: Call[]) => Promise<void>,
) {
  const env = {
    SUPABASE_URL: "https://billing-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: "fixture-billing-salt",
  };
  const previousEnv = new Map(
    Object.keys(env).map((key) => [key, Deno.env.get(key)]),
  );
  const previousFetch = globalThis.fetch;
  const calls: Call[] = [];
  for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
  globalThis.fetch = async (input, init) => {
    const outbound = new Request(input, init);
    const url = new URL(outbound.url);
    const text = await outbound.text();
    const body: unknown = text ? JSON.parse(text) : null;
    calls.push({ url, body, method: outbound.method });
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
      assertEquals(url.searchParams.get("select"), "role");
      assertEquals(url.searchParams.get("user_id"), `eq.${actorId}`);
      return Response.json(
        url.searchParams.get("org_id") === `eq.${orgA}` && options.role !== null
          ? { role: options.role ?? "admin" }
          : null,
      );
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
    if (url.pathname === "/rest/v1/organization_billing") {
      assertEquals(url.searchParams.get("org_id"), `eq.${orgA}`);
      assertEquals(outbound.method, "GET");
      assert(url.searchParams.get("select") !== "*");
      if (options.readError) {
        return Response.json({ message: "private-billing-row-detail" }, {
          status: 500,
        });
      }
      return Response.json(
        options.billingAbsent ? null : {
          ...billingRow,
          private_internal_evidence: "never-return",
        },
      );
    }
    if (url.pathname === "/rest/v1/rpc/organizer_upsert_organization_billing") {
      assertEquals(outbound.method, "POST");
      const args = z.object({
        p_actor_id: z.string(),
        p_input: z.record(z.string(), z.unknown()),
      }).strict().parse(body);
      assertEquals(args.p_actor_id, actorId);
      assertEquals(args.p_input.org_id, orgA);
      if (options.databaseError) {
        return Response.json(options.databaseError, { status: 400 });
      }
      const camelPatch = Object.fromEntries(
        Object.entries(args.p_input).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          value,
        ]),
      );
      return Response.json({
        ...billing,
        ...camelPatch,
        secret: "never-return",
      });
    }
    throw new Error(`Unexpected billing fixture route: ${url.pathname}`);
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
function request(route: "read" | "update", body: unknown, auth = true) {
  return new Request(`https://edge.test/organizations/billing/${route}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth ? { authorization: "Bearer fixture-user" } : {}),
    },
    body: JSON.stringify(body),
  });
}
function businessCalls(calls: Call[]) {
  return calls.filter((call) =>
    call.url.pathname === "/rest/v1/organization_billing" ||
    call.url.pathname.endsWith("/organizer_upsert_organization_billing")
  );
}
function quotaCalls(calls: Call[]) {
  return calls.filter((call) =>
    call.url.pathname.endsWith("/consume_rate_limit")
  );
}

Deno.test("organization billing refuses absent and invalid sessions before business access", async () => {
  for (const route of ["read", "update"] as const) {
    for (const auth of [false, true]) {
      await withFixture({ authError: auth }, async (calls) => {
        const response = await handleOrganizationsRequest(
          request(route, {
            orgId: orgA,
            ...(route === "update" ? { city: "Namur" } : {}),
          }, auth),
        );
        assertEquals(response.status, 401);
        assertEquals(await response.json(), { error: "UNAUTHORIZED" });
        assertEquals(calls.length, auth ? 1 : 0);
      });
    }
  }
});

Deno.test("organization billing read returns null or an explicit tenant DTO after membership and quota", async () => {
  for (const role of ["owner", "admin"]) {
    for (const billingAbsent of [false, true]) {
      await withFixture({ role, billingAbsent }, async (calls) => {
        const response = await handleOrganizationsRequest(
          request("read", { orgId: orgA }),
        );
        assertEquals(response.status, 200);
        assertEquals(await response.json(), {
          billing: billingAbsent ? null : billing,
        });
        assertEquals(calls.map((call) => call.url.pathname), [
          "/auth/v1/user",
          "/rest/v1/organization_members",
          "/rest/v1/rpc/consume_rate_limit",
          "/rest/v1/organization_billing",
        ]);
      });
    }
  }
});

Deno.test("organization billing foreign org and missing or insufficient membership fail before quota", async () => {
  for (const route of ["read", "update"] as const) {
    for (
      const scenario of [{ orgId: orgB }, { orgId: orgA, role: null }, {
        orgId: orgA,
        role: "member",
      }]
    ) {
      await withFixture({ role: scenario.role }, async (calls) => {
        const response = await handleOrganizationsRequest(request(route, {
          orgId: scenario.orgId,
          ...(route === "update" ? { city: "Namur" } : {}),
        }));
        assertEquals(response.status, 403);
        assertEquals(await response.json(), { error: "FORBIDDEN" });
        assertEquals(quotaCalls(calls).length, 0);
        assertEquals(businessCalls(calls).length, 0);
      });
    }
  }
});

Deno.test("organization billing rejects actor and VAT validation injection before side effects", async () => {
  for (
    const [key, value] of Object.entries({
      userId: foreignActor,
      actorId: foreignActor,
      role: "owner",
      plan: "pro",
      stripeConnectAllowed: true,
      isVatValidated: true,
      vatValidatedAt: timestamp,
      vatValidationSource: "forged",
      createdAt: timestamp,
      unknown: "field",
    })
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationsRequest(
        request("update", { orgId: orgA, city: "Namur", [key]: value }),
      );
      assertEquals(response.status, 400);
      assertEquals(await response.json(), { error: "VALIDATION_ERROR" });
      assertEquals(calls.length, 1);
    });
  }
  await withFixture({}, async (calls) => {
    const response = await handleOrganizationsRequest(
      request("read", { orgId: orgA, userId: foreignActor }),
    );
    assertEquals(response.status, 400);
    assertEquals(calls.length, 1);
  });
});

Deno.test("organization billing updates preserve omitted keys and explicit nulls with verified actor", async () => {
  for (
    const patch of [
      { city: "Brussels" },
      { addressLine2: null, billingEmail: null, invoiceReference: null },
      { vatCountryCode: null, vatNumber: null },
      { vatCountryCode: "FR" },
    ]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationsRequest(
        request("update", { orgId: orgA, ...patch }),
      );
      assertEquals(response.status, 200);
      assertEquals(await response.json(), { ...billing, ...patch });
      assertEquals(businessCalls(calls)[0].body, {
        p_actor_id: actorId,
        p_input: {
          org_id: orgA,
          ...Object.fromEntries(
            Object.entries(patch).map(([key, value]) => [
              key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
              value,
            ]),
          ),
        },
      });
      assertEquals(businessCalls(calls).length, 1);
      assertEquals(calls.map((call) => call.url.pathname), [
        "/auth/v1/user",
        "/rest/v1/organization_members",
        "/rest/v1/rpc/consume_rate_limit",
        "/rest/v1/rpc/organizer_upsert_organization_billing",
      ]);
    });
  }
});

Deno.test("organization billing normalizes country VAT and email before SQL mutation", () =>
  withFixture({}, async (calls) => {
    const response = await handleOrganizationsRequest(request("update", {
      orgId: orgA,
      countryCode: " be ",
      vatCountryCode: " be ",
      vatNumber: " be 0123 456 789 ",
      billingEmail: " Billing@Example.Test ",
      legalName: " Fixture Company ",
    }));
    assertEquals(response.status, 200);
    assertEquals(businessCalls(calls)[0].body, {
      p_actor_id: actorId,
      p_input: {
        org_id: orgA,
        country_code: "BE",
        vat_country_code: "BE",
        vat_number: "BE0123456789",
        billing_email: "billing@example.test",
        legal_name: "Fixture Company",
      },
    });
  }));

Deno.test("organization billing invalid patch fails before membership quota and mutation", async () => {
  for (
    const patch of [
      {},
      { countryCode: "BEL" },
      { billingEmail: "invalid" },
      { vatCountryCode: "BE", vatNumber: null },
      { vatCountryCode: null, vatNumber: "BE0123456789" },
    { legalName: "   " },
    { city: "  " },
    { addressLine1: "  " },
    { postalCode: "  " },
    ]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleOrganizationsRequest(
        request("update", { orgId: orgA, ...patch }),
      );
      assertEquals(response.status, 400);
      assertEquals(await response.json(), { error: "VALIDATION_ERROR" });
      assertEquals(calls.length, 1);
    });
  }
});

Deno.test("organization billing quota failures block read and mutation with retry responses", async () => {
  for (const quota of ["denied", "unavailable"] as const) {
    for (const route of ["read", "update"] as const) {
      await withFixture({ quota }, async (calls) => {
        const response = await handleOrganizationsRequest(request(route, {
          orgId: orgA,
          ...(route === "update" ? { city: "Namur" } : {}),
        }));
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

Deno.test("organization billing database failures return stable codes without private details", async () => {
  await withFixture({ readError: true }, async () => {
    const response = await handleOrganizationsRequest(
      request("read", { orgId: orgA }),
    );
    assertEquals(response.status, 500);
    assertEquals(await response.json(), { error: "BILLING_LOAD_FAILED" });
  });
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
        message: "private-database-detail",
        status: 500,
        error: "ORGANIZER_OPERATION_FAILED",
      },
    ]
  ) {
    await withFixture(
      { databaseError: { message: scenario.message } },
      async () => {
        const response = await handleOrganizationsRequest(
          request("update", { orgId: orgA, city: "Namur" }),
        );
        assertEquals(response.status, scenario.status);
        assertEquals(await response.json(), { error: scenario.error });
      },
    );
  }
});
