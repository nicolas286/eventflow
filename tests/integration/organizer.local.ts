import { assert, assertEquals } from "@std/assert";
import { createClient } from "@supabase/supabase-js";
import { handleOrganizationsRequest } from "../../supabase/functions/organizations/index.ts";
import { dashboardBootstrapSchema } from "../../shared/schemas/organizations.ts";
import {
  billingReadResponseSchema,
  organizationBillingSchema,
} from "../../shared/schemas/organization-billing.ts";
import { z } from "zod";
import { assetUploadResponseSchema } from "../../shared/schemas/organization-assets.ts";

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing synthetic configuration: ${name}`);
  return value;
}

Deno.test("B1 real Auth/HTTP/PostgREST: organizer identity, transactions, tenants and browser ACLs without business RLS", async () => {
  const base = required("SUPABASE_URL");
  assert(new URL(base).hostname === "127.0.0.1");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(
    base,
    required("SUPABASE_SERVICE_ROLE_KEY"),
    options,
  );
  const users: string[] = [];
  const orgs: string[] = [];
  const assets: string[] = [];
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, handleOrganizationsRequest);
  const origin =
    `http://127.0.0.1:${server.addr.port}/functions/v1/organizations`;
  async function actor() {
    const email = `b1b2-${crypto.randomUUID()}@example.test`;
    const password = `Synthetic-${crypto.randomUUID()}`;
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        platform_terms_version: "2026-10-01",
        platform_terms_accepted: true,
      },
    });
    assert(
      !created.error && created.data.user,
      "Synthetic Auth creation failed",
    );
    users.push(created.data.user.id);
    const client = createClient(base, required("SUPABASE_ANON_KEY"), options);
    const signed = await client.auth.signInWithPassword({ email, password });
    assert(!signed.error && signed.data.session, "Synthetic Auth login failed");
    return {
      id: created.data.user.id,
      token: signed.data.session.access_token,
      client,
    };
  }
  async function call(
    path: string,
    token: string | null,
    body: unknown,
    status = 200,
  ) {
    const response = await fetch(`${origin}/${path}`, {
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
      `Unexpected status for ${path}: ${JSON.stringify(result)}`,
    );
    return result;
  }
  try {
    const a = await actor();
    const b = await actor();
    const outsider = await actor();
    await call("bootstrap", null, {}, 401);
    await call("bootstrap", "invalid-synthetic-session", {}, 401);
    const empty = dashboardBootstrapSchema.parse(
      await call("bootstrap", a.token, {}),
    );
    assertEquals(empty.organization, null);
    const orgA = z.uuid().parse(
      await call("create", a.token, { type: "association", name: "B1 HTTP A" }),
    );
    orgs.push(orgA);
    const orgB = z.uuid().parse(
      await call("create", b.token, { type: "association", name: "B1 HTTP B" }),
    );
    orgs.push(orgB);
    const bootstrap = dashboardBootstrapSchema.parse(
      await call("bootstrap", a.token, { orgId: orgA }),
    );
    assertEquals(bootstrap.profile.userId, a.id);
    assertEquals(bootstrap.membership?.[0]?.role, "owner");
    assertEquals(bootstrap.organization?.createdBy, a.id);
    assertEquals(bootstrap.organizationProfile?.orgId, orgA);
    await call("bootstrap", a.token, { orgId: orgB }, 403);
    await call("bootstrap", outsider.token, { orgId: orgA }, 403);
    await call("update", a.token, { orgId: orgB, name: "Forged" }, 403);
    await call("update", a.token, { orgId: orgA, plan: "pro" }, 400);
    await call("profile", a.token, {
      userId: b.id,
      patch: { firstName: "Forged" },
    }, 403);
    await call("profile", a.token, {
      userId: a.id,
      patch: { stripeConnectAllowed: true },
    }, 400);
    await call("profile", a.token, {
      userId: a.id,
      patch: { firstName: "Alice" },
    });
    await call("seller-identity", a.token, {
      orgId: orgA,
      legalName: "Synthetic seller",
      address: "Rue Exemple 10",
      businessNumber: null,
      sellerType: "non_professional",
      phone: "+3200000000",
    });
    await call("agreements", a.token, {
      orgId: orgA,
      connectVersion: "2026-10-01",
      dpaVersion: "2026-10-01",
      platformTermsVersion: "2026-10-01",
      privacyVersion: "2026-10-01",
    });
    await call("agreements", a.token, {
      orgId: orgA,
      connectVersion: "old",
      dpaVersion: "2026-10-01",
      platformTermsVersion: "2026-10-01",
      privacyVersion: "2026-10-01",
    }, 400);
    assertEquals(
      billingReadResponseSchema.parse(
        await call("billing/read", a.token, { orgId: orgA }),
      ).billing,
      null,
    );
    await call("billing/update", a.token, {
      orgId: orgA,
      legalName: "Incomplete",
    }, 400);
    const billing = organizationBillingSchema.parse(
      await call("billing/update", a.token, {
        orgId: orgA,
        legalName: "Synthetic billing",
        addressLine1: "Rue Exemple 10",
        postalCode: "1000",
        city: "Bruxelles",
        countryCode: "be",
        billingEmail: " BILLING@EXAMPLE.TEST ",
      }),
    );
    assertEquals(billing.billingEmail, "billing@example.test");
    const partial = organizationBillingSchema.parse(
      await call("billing/update", a.token, {
        orgId: orgA,
        addressLine2: null,
      }),
    );
    assertEquals(partial.legalName, billing.legalName);
    assertEquals(partial.addressLine2, null);
    await call("billing/read", a.token, { orgId: orgB }, 403);
    await call("billing/update", a.token, { orgId: orgB, city: "Forged" }, 403);
    await call(
      "billing/update",
      a.token,
      { orgId: orgA, isVatValidated: true },
      400,
    );
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQC8gDAAFsAN1urcuHAAAAAElFTkSuQmCC",
      ),
      (c) => c.charCodeAt(0),
    );
    const upload = async (
      orgId: string,
      token: string,
      bytes: Uint8Array,
      status: number,
    ) => {
      const response = await fetch(
        `${origin}/assets/upload?orgId=${orgId}&kind=logo`,
        {
          method: "POST",
          headers: {
            "content-type": "image/png",
            authorization: `Bearer ${token}`,
          },
          body: new Uint8Array(bytes),
        },
      );
      const result: unknown = await response.json();
      assertEquals(
        response.status,
        status,
        `Unexpected asset status: ${JSON.stringify(result)}`,
      );
      return result;
    };
    await upload(orgB, a.token, png, 403);
    await upload(
      orgA,
      a.token,
      new TextEncoder().encode("<html>forged image</html>"),
      400,
    );
    const asset = assetUploadResponseSchema.parse(
      await upload(orgA, a.token, png, 200),
    );
    assets.push(asset.path);
    assert(asset.path.startsWith(`orgs/${orgA}/logo/`));
    const second = assetUploadResponseSchema.parse(
      await upload(orgA, a.token, png, 200),
    );
    assets.push(second.path);
    assert(
      asset.path !== second.path,
      "Replacement overwrote the previous asset",
    );
    const displayed = await fetch(asset.publicUrl);
    assertEquals(displayed.status, 200);
    assertEquals(displayed.headers.get("content-type"), "image/png");
    assertEquals(new Uint8Array(await displayed.arrayBuffer()), png);
    const directUpload = await a.client.storage.from("public-assets").upload(
      `orgs/${orgA}/logo/forged.png`,
      png,
      { contentType: "image/png" },
    );
    assert(directUpload.error, "Browser Storage write is still open");
    const directRemove = await a.client.storage.from("public-assets").remove([
      asset.path,
    ]);
    assert(
      directRemove.error || !directRemove.data?.some((row) => row.name),
      "Browser Storage delete is still open",
    );
    const filename = asset.path.split("/").at(-1);
    assert(filename);
    const assetId = filename.split(".")[0];
    await call("assets/delete", b.token, {
      orgId: orgA,
      kind: "logo",
      assetId,
      extension: "png",
    }, 403);
    await call("assets/delete", a.token, {
      orgId: orgA,
      kind: "logo",
      assetId,
      extension: "png",
    });
    const removed = await fetch(asset.publicUrl);
    assertEquals(removed.status, 400);
    await removed.arrayBuffer();
    for (
      const table of [
        "organizations",
        "organization_profile",
        "organization_members",
        "user_profile",
        "organization_billing",
      ]
    ) {
      const read = await a.client.from(table).select("*").limit(1);
      assert(read.error, `Browser table ${table} is accessible`);
      assertEquals(read.error.code, "42501");
    }
    const graphql = await a.client.schema("graphql_public").rpc("graphql", {
      query:
        "{ organizationsCollection { edges { node { id name } } } userProfileCollection { edges { node { userId } } } }",
    });
    assert(
      graphql.error || !JSON.stringify(graphql.data).includes(orgA),
      "GraphQL exposed a closed organizer table",
    );
    for (
      const [name, args] of [
        ["get_dashboard_bootstrap", {}],
        ["create_organization", {
          p_input: { type: "association", name: "Forged" },
        }],
        ["rpc_get_organization_billing", { p_org_id: orgA }],
        ["rpc_upsert_organization_billing", {
          p_input: { org_id: orgA, city: "Forged" },
        }],
        ["organizer_create_organization", {
          p_actor_id: b.id,
          p_input: { type: "association", name: "Forged" },
        }],
      ] satisfies [string, Record<string, unknown>][]
    ) {
      const result = await a.client.rpc(name, args);
      assert(result.error, `Browser RPC ${name} is accessible`);
      assert(["42501", "PGRST202"].includes(result.error.code));
    }
  } finally {
    await server.shutdown();
    if (assets.length) {
      assert(
        !(await service.storage.from("public-assets").remove(assets)).error,
      );
    }
    for (const orgId of orgs) {
      assert(
        !(await service.from("organizations").delete().eq("id", orgId)).error,
      );
    }
    for (const userId of users) {
      assert(!(await service.auth.admin.deleteUser(userId)).error);
    }
  }
});
