import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const targets = JSON.parse(
  readFileSync(new URL("../../deploy/environments.json", import.meta.url)),
);
const supabaseUrl = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const expectedUrl = `https://${targets.staging.supabaseProjectRef}.supabase.co`;

assert.equal(supabaseUrl, expectedUrl, "Integration test requires staging");
assert.ok(anonKey, "SUPABASE_ANON_KEY is required");
assert.ok(
  serviceRoleKey,
  "SUPABASE_SERVICE_ROLE_KEY is required in the GitHub staging environment",
);

const runId = `${Date.now()}-${randomUUID()}`;
const email = `accounts-delete-${runId}@eventflow.example`;
const password = `Staging-${randomUUID()}-${randomUUID()}`;
const organizationName = `Accounts deletion integration ${runId}`;
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const client = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let userId;
let orgId;

function dataOrThrow(result, operation) {
  if (result.error) {
    throw new Error(`${operation}: ${result.error.message}`);
  }
  return result.data;
}

try {
  const createdUser = dataOrThrow(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    }),
    "Create account",
  );
  userId = createdUser.user.id;

  const session = dataOrThrow(
    await client.auth.signInWithPassword({ email, password }),
    "Sign in account",
  );
  assert.ok(
    session.session?.access_token,
    "Sign-in must return an access token",
  );

  orgId = dataOrThrow(
    await client.rpc("create_organization", {
      p_input: { name: organizationName, type: "association" },
    }),
    "Create organization",
  );
  assert.match(orgId, /^[0-9a-f-]{36}$/i);

  dataOrThrow(
    await admin.from("subscriptions").insert({
      org_id: orgId,
      provider: "manual",
      plan: "starter",
      status: "active",
    }),
    "Create subscription",
  );

  const response = await fetch(`${supabaseUrl}/functions/v1/accounts/me`, {
    method: "DELETE",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${session.session.access_token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ orgId }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual(
    {
      ok: result.ok,
      orgId: result.orgId,
      userId: result.userId,
      mollieAction: result.mollieAction,
      previous: result.previous,
    },
    {
      ok: true,
      orgId,
      userId,
      mollieAction: "skipped",
      previous: { status: "active", plan: "starter" },
    },
  );

  const organization = dataOrThrow(
    await admin
      .from("organizations")
      .select("status, plan")
      .eq("id", orgId)
      .single(),
    "Check organization",
  );
  assert.deepEqual(organization, { status: "suspended", plan: "free" });

  const subscription = dataOrThrow(
    await admin
      .from("subscriptions")
      .select("org_id")
      .eq("org_id", orgId)
      .maybeSingle(),
    "Check subscription deletion",
  );
  assert.equal(subscription, null);

  const deletedAccount = await admin.auth.admin.getUserById(userId);
  assert.ok(
    deletedAccount.error || !deletedAccount.data.user,
    "Account must be deleted",
  );

  console.log(JSON.stringify({ ok: true, orgId, userId }));
} finally {
  if (orgId) {
    const cleanupOrganization = await admin
      .from("organizations")
      .delete()
      .eq("id", orgId);
    if (cleanupOrganization.error) {
      console.error(
        "Organization cleanup failed",
        cleanupOrganization.error.message,
      );
    }
  }
  if (userId) {
    const existingUser = await admin.auth.admin.getUserById(userId);
    if (existingUser.data.user) {
      const cleanupUser = await admin.auth.admin.deleteUser(userId);
      if (cleanupUser.error) {
        console.error("Account cleanup failed", cleanupUser.error.message);
      }
    }
  }
  await client.auth.signOut();
}
