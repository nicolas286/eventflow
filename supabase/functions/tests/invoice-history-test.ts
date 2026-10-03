import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { invoiceHistoryResponseSchema } from "../../../shared/schemas/invoice-history.ts";
import { handleInvoicesRequest } from "../invoices/index.ts";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "11111111-1111-4111-8111-111111111112";
const actorId = "22222222-2222-4222-8222-222222222222";
const invoiceId = "33333333-3333-4333-8333-333333333333";
const foreignId = "33333333-3333-4333-8333-333333333334";
const issuedAt = "2026-10-01T12:00:00.000Z";
const row = {
  id: invoiceId,
  number: "2026-000001",
  status: "issued",
  issued_at: issuedAt,
  total_cents: 2599,
  due_at: "2026-10-15T12:00:00.000Z",
  payment_reference: "REF-000001",
  provider: "private-provider",
  billing_snapshot: { private: "never-return" },
  pdf_path: "private-storage-path",
};

type CapturedRequest = { url: URL; headers: Headers; body: unknown };
type FixtureOptions = {
  authError?: "invalid" | "expired";
  role?: string | null;
  cursorRow?: unknown;
  rows?: unknown;
  quota?: "denied" | "unavailable";
  databaseError?: boolean;
};

async function withFixture(
  options: FixtureOptions,
  run: (calls: CapturedRequest[]) => Promise<void>,
) {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://invoice-history-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: "fixture-history-salt",
  };
  const previousEnv = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  const previousFetch = globalThis.fetch;
  const calls: CapturedRequest[] = [];
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  globalThis.fetch = async (input, init) => {
    const outbound = new Request(input, init);
    const url = new URL(outbound.url);
    const text = await outbound.text();
    const body: unknown = text ? JSON.parse(text) : null;
    calls.push({ url, headers: outbound.headers, body });
    if (url.pathname === "/auth/v1/user") {
      assertEquals(
        outbound.headers.get("authorization"),
        "Bearer fixture-user",
      );
      if (options.authError) {
        return Response.json({
          code: "bad_jwt",
          message: options.authError === "expired"
            ? "JWT expired"
            : "Invalid JWT",
        }, { status: 401 });
      }
      // Metadata deliberately claims another org and privileges; it is no proof.
      return Response.json({
        id: actorId,
        email: "history@example.test",
        user_metadata: { orgId: orgB, role: "owner" },
      });
    }
    // Every data/quota request must retain the server key, never the user JWT.
    assertEquals(
      outbound.headers.get("authorization"),
      "Bearer fixture-service",
    );
    assertEquals(outbound.headers.get("apikey"), "fixture-service");
    if (url.pathname === "/rest/v1/organization_members") {
      assertEquals(url.searchParams.get("user_id"), `eq.${actorId}`);
      assertEquals(url.searchParams.get("select"), "role");
      const role = options.role === undefined ? "admin" : options.role;
      return Response.json(
        url.searchParams.get("org_id") === `eq.${orgA}` && role !== null
          ? { role }
          : null,
      );
    }
    if (url.pathname === "/rest/v1/rpc/consume_rate_limit") {
      if (options.quota === "unavailable") {
        return Response.json({ message: "private-database-error" }, {
          status: 500,
        });
      }
      return Response.json([{
        allowed: options.quota !== "denied",
        request_count: options.quota === "denied" ? 121 : 1,
        retry_after_seconds: options.quota === "denied" ? 17 : 0,
      }]);
    }
    if (url.pathname === "/rest/v1/invoices") {
      assertEquals(url.searchParams.get("org_id"), `eq.${orgA}`);
      if (options.databaseError) {
        return Response.json({ message: "private-database-error" }, {
          status: 500,
        });
      }
      if (url.searchParams.get("select") === "id,issued_at") {
        assert(url.searchParams.has("id"));
        return Response.json(
          options.cursorRow === undefined
            ? { id: invoiceId, issued_at: issuedAt }
            : options.cursorRow,
        );
      }
      assertEquals(
        url.searchParams.get("select"),
        "id,number,status,issued_at,total_cents,due_at,payment_reference",
      );
      return Response.json(options.rows === undefined ? [row] : options.rows);
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

function request(body: unknown, authenticated = true): Request {
  return rawRequest(JSON.stringify(body), authenticated);
}

function rawRequest(body: string, authenticated = true): Request {
  return new Request("https://edge.test/invoices/list", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer fixture-user" } : {}),
    },
    body,
  });
}

function invoiceCalls(calls: CapturedRequest[]) {
  return calls.filter((call) => call.url.pathname === "/rest/v1/invoices");
}

Deno.test("invoice history rejects absent, invalid and expired sessions before DB", async () => {
  await withFixture({}, async (calls) => {
    const response = await handleInvoicesRequest(
      request({ orgId: orgA }, false),
    );
    assertEquals(response.status, 401);
    assertEquals(await response.json(), { error: "UNAUTHORIZED" });
    assertEquals(calls.length, 0);
  });
  for (
    const authError of [
      "invalid",
      "expired",
    ] satisfies FixtureOptions["authError"][]
  ) {
    await withFixture({ authError }, async (calls) => {
      const response = await handleInvoicesRequest(request({ orgId: orgA }));
      assertEquals(response.status, 401);
      assertEquals(await response.json(), { error: "UNAUTHORIZED" });
      assertEquals(calls.length, 1);
    });
  }
});

Deno.test("invoice history authorizes owner and admin, maps only the validated UI DTO", async () => {
  for (const role of ["owner", "admin"]) {
    await withFixture({ role }, async (calls) => {
      const response = await handleInvoicesRequest(request({ orgId: orgA }));
      assertEquals(response.status, 200);
      const result = invoiceHistoryResponseSchema.parse(await response.json());
      assertEquals(result, {
        orgId: orgA,
        items: [{
          id: invoiceId,
          number: "2026-000001",
          status: "issued",
          issuedAt,
          totalCents: 2599,
          dueAt: row.due_at,
          paymentReference: row.payment_reference,
        }],
        nextCursor: null,
      });
      assertEquals(invoiceCalls(calls).length, 1);
      assertEquals(invoiceCalls(calls)[0].url.searchParams.get("limit"), "25");
      assertEquals(
        invoiceCalls(calls)[0].url.searchParams.get("order"),
        "issued_at.desc.nullslast,id.desc",
      );
      const quota = calls.find((call) =>
        call.url.pathname.endsWith("/consume_rate_limit")
      );
      assert(quota);
      const payload = z.object({
        p_key_hash: z.string(),
        p_scope: z.string(),
      }).parse(quota.body);
      assertEquals(payload.p_scope, "invoices:history:1m");
      assertEquals(payload.p_key_hash.includes(actorId), false);
      assertEquals(calls.map((call) => call.url.pathname), [
        "/auth/v1/user",
        "/rest/v1/organization_members",
        "/rest/v1/rpc/consume_rate_limit",
        "/rest/v1/invoices",
      ]);
    });
  }
});

Deno.test("invoice history refuses foreign org, absent membership and unknown role without reading invoices or quotas", async () => {
  // No lower-privilege real role exists: owner/admin exhaust the SQL constraint.
  // An unexpected role still fails closed, including when metadata says owner.
  for (
    const scenario of [
      { options: {}, body: { orgId: orgB } },
      { options: { role: null }, body: { orgId: orgA } },
      { options: { role: "unknown-role" }, body: { orgId: orgA } },
    ]
  ) {
    await withFixture(scenario.options, async (calls) => {
      const response = await handleInvoicesRequest(request(scenario.body));
      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: "FORBIDDEN" });
      assertEquals(invoiceCalls(calls).length, 0);
      assertEquals(
        calls.some((call) => call.url.pathname.endsWith("/consume_rate_limit")),
        false,
      );
    });
  }
});

Deno.test("invoice history rejects malformed JSON, invalid payload, actor spoofing and oversized body", async () => {
  for (
    const scenario of [
      { body: "{", status: 400, error: "INVALID_JSON" },
      {
        body: JSON.stringify({ orgId: "invalid" }),
        status: 400,
        error: "VALIDATION_ERROR",
      },
      {
        body: JSON.stringify({ orgId: orgA, limit: 101 }),
        status: 400,
        error: "VALIDATION_ERROR",
      },
      {
        body: JSON.stringify({ orgId: orgA, userId: actorId }),
        status: 400,
        error: "VALIDATION_ERROR",
      },
      {
        body: JSON.stringify({ orgId: orgA, cursor: { id: invoiceId } }),
        status: 400,
        error: "VALIDATION_ERROR",
      },
      {
        body: JSON.stringify({ orgId: orgA, padding: "x".repeat(4096) }),
        status: 413,
        error: "PAYLOAD_TOO_LARGE",
      },
    ]
  ) {
    await withFixture({}, async (calls) => {
      const response = await handleInvoicesRequest(rawRequest(scenario.body));
      assertEquals(response.status, scenario.status);
      assertEquals(await response.json(), { error: scenario.error });
      assertEquals(calls.length, 1);
    });
  }
});

Deno.test("invoice history quota denies before invoice reads with controlled retry errors", async () => {
  for (
    const quota of ["denied", "unavailable"] satisfies FixtureOptions["quota"][]
  ) {
    await withFixture({ quota }, async (calls) => {
      const response = await handleInvoicesRequest(request({ orgId: orgA }));
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
      assertEquals(invoiceCalls(calls).length, 0);
    });
  }
});

Deno.test("invoice history refuses foreign or tampered cursor without unbounded resource lookup", async () => {
  for (
    const scenario of [
      { cursorRow: null, id: foreignId, timestamp: issuedAt },
      {
        cursorRow: { id: invoiceId, issued_at: issuedAt },
        id: invoiceId,
        timestamp: "2026-09-01T12:00:00.000Z",
      },
      {
        cursorRow: { id: invoiceId, issued_at: issuedAt },
        id: invoiceId,
        timestamp: null,
      },
    ]
  ) {
    await withFixture({ cursorRow: scenario.cursorRow }, async (calls) => {
      const response = await handleInvoicesRequest(request({
        orgId: orgA,
        cursor: { id: scenario.id, issuedAt: scenario.timestamp },
      }));
      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: "FORBIDDEN" });
      assertEquals(invoiceCalls(calls).length, 1);
      assertEquals(
        invoiceCalls(calls)[0].url.searchParams.get("id"),
        `eq.${scenario.id}`,
      );
    });
  }
});

Deno.test("invoice history scopes dated cursor pagination to the org, including null dated invoices", () =>
  withFixture({ rows: [{ ...row, issued_at: null }] }, async (calls) => {
    const response = await handleInvoicesRequest(request({
      orgId: orgA,
      limit: 1,
      cursor: { id: invoiceId, issuedAt },
    }));
    assertEquals(response.status, 200);
    const result = invoiceHistoryResponseSchema.parse(await response.json());
    assertEquals(result.nextCursor, { id: invoiceId, issuedAt: null });
    const query = invoiceCalls(calls)[1].url.searchParams;
    assertEquals(
      query.get("or"),
      `(issued_at.lt.${issuedAt},and(issued_at.eq.${issuedAt},id.lt.${invoiceId}),issued_at.is.null)`,
    );
    assertEquals(query.get("limit"), "1");
  }));

Deno.test("invoice history continues null-date pagination with resource and org bounds", () =>
  withFixture(
    { cursorRow: { id: invoiceId, issued_at: null }, rows: [] },
    async (calls) => {
      const response = await handleInvoicesRequest(request({
        orgId: orgA,
        cursor: { id: invoiceId, issuedAt: null },
      }));
      assertEquals(response.status, 200);
      assertEquals(invoiceHistoryResponseSchema.parse(await response.json()), {
        orgId: orgA,
        items: [],
        nextCursor: null,
      });
      const query = invoiceCalls(calls)[1].url.searchParams;
      assertEquals(query.get("issued_at"), "is.null");
      assertEquals(query.get("id"), `lt.${invoiceId}`);
      assertEquals(query.has("or"), false);
    },
  ));

Deno.test("invoice history rejects malformed DB response and hides database details", async () => {
  for (
    const scenario of [
      {
        options: { rows: [{ ...row, total_cents: -1 }] },
        error: "INVOICE_HISTORY_RESPONSE_INVALID",
      },
      {
        options: { databaseError: true },
        error: "INVOICE_HISTORY_LOAD_FAILED",
      },
    ]
  ) {
    await withFixture(scenario.options, async () => {
      const response = await handleInvoicesRequest(request({ orgId: orgA }));
      assertEquals(response.status, 500);
      assertEquals(await response.json(), { error: scenario.error });
    });
  }
});
