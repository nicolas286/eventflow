import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleOrganizationPaymentSettingsRequest } from "../../supabase/functions/organization-payment-settings/index.ts";
import { organizationPaymentSettingsResultSchema } from "../../shared/schemas/bank-transfer.ts";
import { hashRateLimitKey } from "../../supabase/functions/_shared/modules/supabase-rate-limit/hash-key.ts";
import { applicationRateLimits } from "../../supabase/functions/_shared/app/config/rate-limits.ts";
import { handleOrdersRequest } from "../../supabase/functions/orders/index.ts";
import { adminRegisterSuccessSchema } from "../../supabase/functions/orders/admin/adminRegister.contracts.ts";

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}
Deno.test("B6 payment settings: real Auth, server actor, tenants, quota and closed SQL/GraphQL without RLS", async () => {
  const base = env("SUPABASE_URL");
  assertEquals(new URL(base).hostname, "127.0.0.1");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(base, env("SUPABASE_SERVICE_ROLE_KEY"), options);
  const anon = createClient(base, env("SUPABASE_ANON_KEY"), options);
  const users: string[] = [], orgs = [crypto.randomUUID(), crypto.randomUUID()];
  const server = Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      onListen: () => {},
    },
    (req) =>
      new URL(req.url).pathname.includes("/orders/admin")
        ? handleOrdersRequest(req)
        : handleOrganizationPaymentSettingsRequest(req),
  );
  async function actor() {
    const email = `b6-${crypto.randomUUID()}@example.test`,
      password = `Synthetic-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert(!created.error && created.data.user);
    users.push(created.data.user.id);
    const client = createClient(base, env("SUPABASE_ANON_KEY"), options);
    const signed = await client.auth.signInWithPassword({ email, password });
    assert(!signed.error && signed.data.session);
    return {
      id: created.data.user.id,
      token: signed.data.session.access_token,
      client,
    };
  }
  async function call(body: object, token: string | null, status: number) {
    const response = await fetch(`http://127.0.0.1:${server.addr.port}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    const data: unknown = await response.json();
    assertEquals(response.status, status, JSON.stringify(data));
    if (status === 200) {
      return organizationPaymentSettingsResultSchema.parse(data);
    }
  }
  try {
    const a = await actor(), b = await actor();
    assert(
      !(await service.from("organizations").insert(
        orgs.map((id) => ({ id, name: "B6 synthetic", type: "association" })),
      )).error,
    );
    assert(
      !(await service.from("organization_members").insert([{
        org_id: orgs[0],
        user_id: a.id,
        role: "owner",
      }, { org_id: orgs[1], user_id: b.id, role: "owner" }])).error,
    );
    assert(
      !(await service.from("organization_profile").insert(
        orgs.map((org_id) => ({
          org_id,
          display_name: "B6 synthetic",
          slug: `b6-${org_id}`,
          public_email: "synthetic@example.test",
        })),
      )).error,
    );
    const terms = "Conditions synthétiques. ".repeat(12);
    const families = [
      {
        body: { action: "read", orgId: orgs[0] },
        policy: applicationRateLimits.paymentSettingsRead,
      },
      {
        body: {
          action: "accept_terms",
          orgId: orgs[0],
          salesTerms: terms,
          confirmed: true,
        },
        policy: applicationRateLimits.paymentSettingsAcceptTerms,
      },
      {
        body: {
          action: "update",
          orgId: orgs[0],
          paymentsProvider: "stripe",
          bankTransferBeneficiary: null,
          bankTransferIban: null,
        },
        policy: applicationRateLimits.paymentSettingsUpdate,
      },
    ];
    for (const { body } of families) {
      await call(body, null, 401);
      await call(body, "invalid", 401);
      await call(body, b.token, 403);
      await call({ ...body, actorId: b.id }, a.token, 400);
      await call(body, a.token, 200);
    }
    const profile = await service.from("organization_profile").select(
      "sales_terms_accepted_by",
    ).eq("org_id", orgs[0]).single();
    assertEquals(profile.data?.sales_terms_accepted_by, a.id);
    const events = [crypto.randomUUID(), crypto.randomUUID()],
      products = [crypto.randomUUID(), crypto.randomUUID()];
    assert(
      !(await service.from("events").insert(
        events.map((id, i) => ({
          id,
          org_id: orgs[i],
          slug: `b6-${id}`,
          title: "Synthetic creation",
          is_published: true,
          starts_at: "2099-01-01T12:00:00Z",
          ends_at: "2099-01-02T12:00:00Z",
        })),
      )).error,
    );
    assert(
      !(await service.from("event_products").insert(
        products.map((id, i) => ({
          id,
          event_id: events[i],
          name: "Synthetic free ticket",
          price_cents: 0,
          stock_qty: 10,
          creates_attendees: true,
        })),
      )).error,
    );
    const createOrder = async (
      token: string | null,
      productId: string,
      status: number,
    ) => {
      const response = await fetch(
        `http://127.0.0.1:${server.addr.port}/functions/v1/orders/admin`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            eventId: events[0],
            buyer: { email: "synthetic@example.test" },
            items: [{ eventProductId: productId, quantity: 1 }],
            attendees: [{ eventProductId: productId }],
          }),
        },
      );
      const data: unknown = await response.json();
      assertEquals(response.status, status, JSON.stringify(data));
      if (status === 200) adminRegisterSuccessSchema.parse(data);
    };
    await createOrder(null, products[0], 401);
    await createOrder("invalid", products[0], 401);
    await createOrder(b.token, products[0], 403);
    await createOrder(a.token, products[1], 400);
    await createOrder(a.token, products[0], 200);
    const creationPolicy = applicationRateLimits.adminOrderCreate;
    const creationKey = await hashRateLimitKey(
      `user:${a.id}:org:${orgs[0]}`,
      env("RATE_LIMIT_SALT"),
    );
    for (let i = 0; i < creationPolicy.limit; i++) {
      assert(
        !(await service.rpc("consume_rate_limit", {
          p_key_hash: creationKey,
          p_scope: creationPolicy.scope,
          p_limit: creationPolicy.limit,
          p_window_seconds: creationPolicy.windowSeconds,
        })).error,
      );
    }
    await createOrder(a.token, products[0], 429);
    for (const client of [anon, a.client]) {
      assert((await client.from("organizations").select("id")).error);
      assert(
        (await client.rpc("update_organization_payment_settings", {
          p_org_id: orgs[0],
          p_provider: "stripe",
        })).error,
      );
      assert(
        (await client.rpc("organizer_update_organization_payment_settings", {
          p_actor_id: a.id,
          p_org_id: orgs[0],
          p_provider: "stripe",
        })).error,
      );
      const graph = await fetch(`${base}/graphql/v1`, {
        method: "POST",
        headers: {
          apikey: env("SUPABASE_ANON_KEY"),
          authorization: `Bearer ${
            client === anon ? env("SUPABASE_ANON_KEY") : a.token
          }`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          query: "{ organizationsCollection { edges { node { id } } } }",
        }),
      });
      const graphData: unknown = await graph.json();
      assert(
        graph.status >= 400 || JSON.stringify(graphData).includes('"errors"'),
      );
      assert(!JSON.stringify(graphData).includes(orgs[0]));
    }
    for (const { body, policy } of families) {
      const key = await hashRateLimitKey(
        `user:${a.id}:org:${orgs[0]}`,
        env("RATE_LIMIT_SALT"),
      );
      for (let i = 0; i < policy.limit; i++) {
        assert(
          !(await service.rpc("consume_rate_limit", {
            p_key_hash: key,
            p_scope: policy.scope,
            p_limit: policy.limit,
            p_window_seconds: policy.windowSeconds,
          })).error,
        );
      }
      await call(body, a.token, 429);
    }
  } finally {
    await server.shutdown();
    await service.from("organizations").delete().in("id", orgs);
    for (const id of users) await service.auth.admin.deleteUser(id);
  }
});
