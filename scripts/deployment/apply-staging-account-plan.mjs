import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const targets = JSON.parse(
  readFileSync(new URL("../../deploy/environments.json", import.meta.url)),
);
const url = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const email = process.env.STAGING_ACCOUNT_EMAIL?.trim().toLowerCase();
const plan = process.env.STAGING_ACCOUNT_PLAN?.trim().toLowerCase();

const expectedUrl = `https://${targets.staging.supabaseProjectRef}.supabase.co`;
if (
  url !== expectedUrl ||
  targets.staging.supabaseProjectRef === targets.production.supabaseProjectRef
) {
  throw new Error("Account plan update refused: staging project required");
}
if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
if (!email) throw new Error("STAGING_ACCOUNT_EMAIL is required");
if (!["free", "starter", "pro"].includes(plan)) {
  throw new Error("STAGING_ACCOUNT_PLAN must be free, starter or pro");
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function checked(result, operation) {
  if (result.error) throw new Error(`${operation}: ${result.error.message}`);
  return result.data;
}

let matchedUser = null;
for (let page = 1; page <= 20 && !matchedUser; page += 1) {
  const response = checked(
    await admin.auth.admin.listUsers({ page, perPage: 1000 }),
    "Unable to list staging users",
  );
  matchedUser = response.users.find(
    (user) => user.email?.trim().toLowerCase() === email,
  );
  if (response.users.length < 1000) break;
}

if (!matchedUser) throw new Error("Staging account not found");

const memberships = checked(
  await admin
    .from("organization_members")
    .select("org_id, role")
    .eq("user_id", matchedUser.id),
  "Unable to load organization memberships",
);

if (memberships.length !== 1) {
  throw new Error(
    `Expected exactly one organization membership, found ${memberships.length}`,
  );
}

const membership = memberships[0];
const organization = checked(
  await admin
    .from("organizations")
    .select("id, plan, plan_expires_at")
    .eq("id", membership.org_id)
    .single(),
  "Unable to load the staging organization",
);

const updatedOrganization = checked(
  await admin
    .from("organizations")
    .update({
      plan,
      plan_started_at: new Date().toISOString(),
      plan_expires_at: "2099-12-31T23:59:59.000Z",
      updated_at: new Date().toISOString(),
    })
    .eq("id", organization.id)
    .select("plan, plan_expires_at")
    .single(),
  "Unable to update the staging organization plan",
);

console.log(
  JSON.stringify({
    updated: true,
    membershipRole: membership.role,
    previousPlan: organization.plan,
    plan: updatedOrganization.plan,
    planExpiresAt: updatedOrganization.plan_expires_at,
  }),
);
