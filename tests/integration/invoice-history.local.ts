// Real Auth/PostgREST/Storage, synthetic fixtures, loopback-only. Invoked by
// invoice-history.local.mjs after replay + deferred closure on a disposable DB.
import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleInvoicesRequest } from "../../supabase/functions/invoices/index.ts";
import { invoiceHistoryResponseSchema } from "../../shared/schemas/invoice-history.ts";
import { hashRateLimitKey } from "../../supabase/functions/_shared/modules/supabase-rate-limit/mod.ts";

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing local fixture configuration: ${name}`);
  return value;
}

Deno.test("B0 real HTTP: session, tenant, pagination, ACLs and Storage without business RLS", async () => {
  const base = required("SUPABASE_URL");
  const parsedBase = new URL(base);
  assert(
    parsedBase.protocol === "http:" && parsedBase.hostname === "127.0.0.1",
  );
  const anonKey = required("SUPABASE_ANON_KEY");
  const service = createClient(base, required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const browser = () =>
    createClient(base, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const users: string[] = [];
  const orgA = crypto.randomUUID();
  const orgB = crypto.randomUUID();
  const orgEmpty = crypto.randomUUID();
  const invoiceA = crypto.randomUUID();
  const invoiceB = crypto.randomUUID();
  const invoiceUndated = crypto.randomUUID();
  const pathA = `${orgA}/2026/B0-A.pdf`;
  const pathB = `${orgB}/2026/B0-B.pdf`;
  const password = `Synthetic-B0-${crypto.randomUUID()}`;
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, handleInvoicesRequest);
  const url = `http://127.0.0.1:${server.addr.port}/functions/v1/invoices/list`;
  async function actor() {
    const email = `b0-${crypto.randomUUID()}@example.test`;
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert(
      !created.error && created.data.user,
      "Local fixture Auth creation failed",
    );
    users.push(created.data.user.id);
    const client = browser();
    const signed = await client.auth.signInWithPassword({ email, password });
    assert(!signed.error && signed.data.session, "Local fixture login failed");
    return {
      client,
      id: created.data.user.id,
      token: signed.data.session.access_token,
    };
  }
  async function call(token: string | null, body: unknown, status: number) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const result: unknown = await response.json();
    assertEquals(response.status, status);
    if (status !== 200) {
      assert(
        !JSON.stringify(result).includes("B0-B"),
        "Refusal exposed foreign data",
      );
    }
    return { result, response };
  }
  try {
    const a = await actor();
    const b = await actor();
    const outsider = await actor();
    const admin = await actor();
    const empty = await actor();
    assert(
      !(await service.from("organizations").insert([
        { id: orgA, type: "association", name: "B0 HTTP A" },
        { id: orgB, type: "association", name: "B0 HTTP B" },
        { id: orgEmpty, type: "association", name: "B0 HTTP empty" },
      ])).error,
    );
    assert(
      !(await service.from("organization_members").insert([
        { org_id: orgA, user_id: a.id, role: "owner" },
        { org_id: orgB, user_id: b.id, role: "owner" },
        { org_id: orgA, user_id: admin.id, role: "admin" },
        { org_id: orgEmpty, user_id: empty.id, role: "owner" },
      ])).error,
    );
    const bucket = await service.storage.createBucket("invoices", {
      public: false,
    });
    assert(!bucket.error || bucket.error.message.includes("already exists"));
    assert(
      !(await service.storage.from("invoices").upload(
        pathA,
        new TextEncoder().encode("Synthetic B0 A"),
        { contentType: "application/pdf" },
      )).error,
    );
    assert(
      !(await service.storage.from("invoices").upload(
        pathB,
        new TextEncoder().encode("Synthetic B0 B"),
        { contentType: "application/pdf" },
      )).error,
    );
    assert(
      !(await service.from("invoices").insert([
        {
          id: invoiceA,
          org_id: orgA,
          number: `B0-A-${invoiceA.slice(0, 8)}`,
          status: "issued",
          issued_at: "2026-10-02T12:00:00Z",
          due_at: "2026-10-10T12:00:00Z",
          payment_reference: "B0-A-REFERENCE",
          subtotal_cents: 100,
          total_cents: 100,
          pdf_path: pathA,
        },
        {
          id: invoiceB,
          org_id: orgB,
          number: `B0-B-${invoiceB.slice(0, 8)}`,
          status: "issued",
          issued_at: "2026-10-02T12:00:00Z",
          subtotal_cents: 200,
          total_cents: 200,
          pdf_path: pathB,
        },
        {
          id: invoiceUndated,
          org_id: orgA,
          number: `B0-DRAFT-${invoiceUndated.slice(0, 8)}`,
          status: "draft",
          subtotal_cents: 0,
          total_cents: 0,
        },
      ])).error,
    );

    await call(null, { orgId: orgA }, 401);
    await call("invalid-fixture-session", { orgId: orgA }, 401);
    // Sign an actually expired local JWT; never use or print a remote secret.
    const encode = (value: unknown) =>
      btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(
        /\//g,
        "_",
      );
    const jwt = `${encode({ alg: "HS256", typ: "JWT" })}.${
      encode({
        sub: a.id,
        role: "authenticated",
        aud: "authenticated",
        exp: Math.floor(Date.now() / 1000) - 60,
      })
    }`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(required("B0_LOCAL_JWT_SECRET")),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(jwt),
    );
    const encodedSignature = btoa(
      String.fromCharCode(...new Uint8Array(signature)),
    ).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    await call(`${jwt}.${encodedSignature}`, { orgId: orgA }, 401);

    const first = invoiceHistoryResponseSchema.parse(
      (await call(a.token, { orgId: orgA, limit: 1 }, 200)).result,
    );
    assertEquals(first.items[0]?.id, invoiceA);
    assertEquals(first.items[0]?.paymentReference, "B0-A-REFERENCE");
    assert(first.nextCursor);
    const second = invoiceHistoryResponseSchema.parse(
      (await call(
        a.token,
        { orgId: orgA, limit: 1, cursor: first.nextCursor },
        200,
      )).result,
    );
    assertEquals(second.items[0]?.id, invoiceUndated);
    assert(second.nextCursor);
    const last = invoiceHistoryResponseSchema.parse(
      (await call(
        a.token,
        { orgId: orgA, limit: 1, cursor: second.nextCursor },
        200,
      )).result,
    );
    assertEquals(last.items, []);
    assertEquals(last.nextCursor, null);
    await call(admin.token, { orgId: orgA }, 200);
    await call(b.token, { orgId: orgB }, 200);
    const noRows = invoiceHistoryResponseSchema.parse(
      (await call(empty.token, { orgId: orgEmpty }, 200)).result,
    );
    assertEquals(noRows.items, []);
    await call(a.token, { orgId: orgB }, 403);
    await call(b.token, { orgId: orgA }, 403);
    await call(outsider.token, { orgId: orgA }, 403);
    await call(a.token, {
      orgId: orgA,
      cursor: { id: invoiceB, issuedAt: "2026-10-02T12:00:00Z" },
    }, 403);
    await call(a.token, {
      orgId: orgA,
      cursor: { id: invoiceA, issuedAt: "2026-10-01T12:00:00Z" },
    }, 403);
    await call(a.token, { orgId: orgA, userId: b.id }, 400);
    await call(a.token, { orgId: "malformed" }, 400);

    for (const client of [browser(), a.client, b.client]) {
      const legacy = await client.rpc("rpc_list_invoices", { p_org_id: orgA });
      assert(
        legacy.error && legacy.data === null,
        "Legacy RPC still accessible",
      );
      assert(
        ["42501", "PGRST202"].includes(legacy.error.code),
        "Unexpected legacy RPC failure",
      );
      const rows = await client.from("invoices").select("number");
      assert(
        rows.error && rows.data === null,
        "Equivalent table/column read still accessible",
      );
      assertEquals(rows.error.code, "42501");
      const graphql = await client.schema("graphql_public").rpc("graphql", {
        query: "{ invoicesCollection { edges { node { id number } } } }",
      });
      assert(
        graphql.error || !JSON.stringify(graphql.data).includes(invoiceA),
        "GraphQL exposed history",
      );
      const listing = await client.storage.from("invoices").list(
        `${orgA}/2026`,
      );
      assert(
        listing.error || listing.data?.length === 0,
        "Storage history listing still accessible",
      );
      const download = await client.storage.from("invoices").download(pathA);
      assert(
        download.error && download.data === null,
        "Storage download still accessible",
      );
      const signing = await client.storage.from("invoices").createSignedUrl(
        pathA,
        60,
      );
      assert(
        signing.error && signing.data === null,
        "Browser Storage signing still accessible",
      );
    }
    // Existing server PDF path still signs and serves a previously stored PDF.
    const pdf = await fetch(url.replace("/list", `/${invoiceA}/pdf`), {
      headers: { authorization: `Bearer ${a.token}` },
    });
    assertEquals(pdf.status, 200);
    const signed: unknown = await pdf.json();
    assert(
      typeof signed === "object" && signed !== null && "url" in signed &&
        typeof signed.url === "string",
    );
    const document = await fetch(signed.url);
    assertEquals(document.status, 200);
    assertEquals(await document.text(), "Synthetic B0 A");
    for (const token of [null, "invalid-session"]) {
      const invalidPdf = await fetch(url.replace("/list", `/${invoiceA}/pdf`), {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      assertEquals(invalidPdf.status, 401);
      await invalidPdf.body?.cancel();
    }
    const deniedPdf = await fetch(url.replace("/list", `/${invoiceB}/pdf`), {
      headers: { authorization: `Bearer ${a.token}` },
    });
    assertEquals(deniedPdf.status, 403);
    await deniedPdf.body?.cancel();
    // Exhaust only this synthetic actor/org/operation's real SQL budget.
    const quotaKey = await hashRateLimitKey(
      `user:${a.id}:org:${orgA}`,
      required("RATE_LIMIT_SALT"),
    );
    for (let attempt = 0; attempt < 60; attempt++) {
      const consumed = await service.rpc("consume_rate_limit", {
        p_key_hash: quotaKey,
        p_scope: "invoices:pdf:1m",
        p_limit: 60,
        p_window_seconds: 60,
      });
      assert(!consumed.error);
    }
    const limitedPdf = await fetch(url.replace("/list", `/${invoiceA}/pdf`), {
      headers: { authorization: `Bearer ${a.token}` },
    });
    assertEquals(limitedPdf.status, 429);
    await limitedPdf.body?.cancel();
    for (let attempt = 0; attempt < 120; attempt++) {
      const consumed = await service.rpc("consume_rate_limit", {
        p_key_hash: quotaKey,
        p_scope: "invoices:history:1m",
        p_limit: 120,
        p_window_seconds: 60,
      });
      assert(!consumed.error, "Fixture quota consumption failed");
    }
    const limited = await call(a.token, { orgId: orgA }, 429);
    assert(Number(limited.response.headers.get("retry-after")) > 0);
    assertEquals(limited.result, { error: "TOO_MANY_REQUESTS" });
    await call(b.token, { orgId: orgB }, 200);
  } finally {
    await service.storage.from("invoices").remove([pathA, pathB]);
    await service.from("organizations").delete().in("id", [
      orgA,
      orgB,
      orgEmpty,
    ]);
    for (const id of users) await service.auth.admin.deleteUser(id);
    await server.shutdown();
  }
});
