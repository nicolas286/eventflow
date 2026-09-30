import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import { ResponseError } from "../_shared/errors.ts";
import {
  assertRecentTotp,
  randomStepUpToken,
  sha256Hex,
} from "../platform-admin/auth.ts";
import { handlePlatformAdminRequest } from "../platform-admin/index.ts";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

function jwt(aal: "aal1" | "aal2", freshTotp = false) {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const amr = [
    { method: "password", timestamp: 1 },
    ...(freshTotp
      ? [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }]
      : []),
  ];
  return `${encode({ alg: "none" })}.${encode({ aal, session_id: sessionId, amr })}.signature`;
}

async function withRuntime(run: () => Promise<void>) {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://platform-fixture.supabase.co",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    RATE_LIMIT_SALT: "fixture-rate-limit-salt",
    APP_ENV: "staging",
    MAIL_MODE: "capture",
  };
  const previous = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  try {
    await run();
  } finally {
    for (const [key, value] of previous)
      value === undefined ? Deno.env.delete(key) : Deno.env.set(key, value);
  }
}

Deno.test("step-up rejects stale TOTP and accepts a fresh one", async () => {
  const stale = await assertRejects(
    () =>
      Promise.resolve().then(() =>
        assertRecentTotp({
          aal: "aal2",
          sessionId,
          authenticationMethods: [
            { method: "totp", timestamp: Math.floor(Date.now() / 1000) - 121 },
          ],
        }),
      ),
    ResponseError,
  );
  assertEquals(stale.code, "PLATFORM_RECENT_MFA_REQUIRED");
  assertRecentTotp({
    aal: "aal2",
    sessionId,
    authenticationMethods: [
      { method: "totp", timestamp: Math.floor(Date.now() / 1000) },
    ],
  });
});

Deno.test("step-up tokens are random and hash deterministically", async () => {
  const first = randomStepUpToken();
  const second = randomStepUpToken();
  assertEquals(first.length >= 32, true);
  assertNotEquals(first, second);
  assertEquals(await sha256Hex(first), await sha256Hex(first));
  assertNotEquals(await sha256Hex(first), first);
});

Deno.test("platform endpoint rejects anonymous access", () =>
  withRuntime(async () => {
    const response = await handlePlatformAdminRequest(
      new Request("https://edge.test/platform-admin/access"),
    );
    assertEquals(response.status, 401);
  }),
);

Deno.test("platform endpoint rejects a signed-in non-admin", () =>
  withRuntime(async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (input) => {
      const url = String(input);
      if (url.includes("/auth/v1/user"))
        return Promise.resolve(
          Response.json({
            id: userId,
            email: "organizer@example.test",
            email_confirmed_at: new Date().toISOString(),
          }),
        );
      if (url.includes("consume_rate_limit"))
        return Promise.resolve(
          Response.json([
            { allowed: true, request_count: 1, retry_after_seconds: 0 },
          ]),
        );
      if (url.includes("platform_admin_access_state"))
        return Promise.resolve(
          Response.json({ isPlatformAdmin: false, sessionActive: true }),
        );
      return Promise.resolve(Response.json(null));
    };
    try {
      const response = await handlePlatformAdminRequest(
        new Request("https://edge.test/platform-admin/access", {
          headers: { authorization: `Bearer ${jwt("aal2", true)}` },
        }),
      );
      assertEquals(response.status, 403);
      assertEquals(await response.json(), { error: "PLATFORM_FORBIDDEN" });
    } finally {
      globalThis.fetch = previousFetch;
    }
  }),
);

Deno.test(
  "platform endpoint rejects a revoked session before returning data",
  () =>
    withRuntime(async () => {
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/user"))
          return Promise.resolve(
            Response.json({
              id: userId,
              email: "admin@example.test",
              email_confirmed_at: new Date().toISOString(),
            }),
          );
        if (url.includes("consume_rate_limit"))
          return Promise.resolve(
            Response.json([
              { allowed: true, request_count: 1, retry_after_seconds: 0 },
            ]),
          );
        if (url.includes("platform_admin_access_state"))
          return Promise.resolve(
            Response.json({ isPlatformAdmin: true, sessionActive: false }),
          );
        return Promise.resolve(Response.json(null));
      };
      try {
        const response = await handlePlatformAdminRequest(
          new Request("https://edge.test/platform-admin/overview", {
            headers: { authorization: `Bearer ${jwt("aal2", true)}` },
          }),
        );
        assertEquals(response.status, 401);
        assertEquals(await response.json(), {
          error: "PLATFORM_SESSION_REVOKED",
        });
      } finally {
        globalThis.fetch = previousFetch;
      }
    }),
);

Deno.test(
  "aal1 admin can inspect access state but cannot read platform data",
  () =>
    withRuntime(async () => {
      const previousFetch = globalThis.fetch;
      globalThis.fetch = (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/user"))
          return Promise.resolve(
            Response.json({
              id: userId,
              email: "admin@example.test",
              email_confirmed_at: new Date().toISOString(),
            }),
          );
        if (url.includes("consume_rate_limit"))
          return Promise.resolve(
            Response.json([
              { allowed: true, request_count: 1, retry_after_seconds: 0 },
            ]),
          );
        if (url.includes("platform_admin_access_state"))
          return Promise.resolve(
            Response.json({ isPlatformAdmin: true, sessionActive: true }),
          );
        return Promise.resolve(Response.json(null));
      };
      try {
        const headers = { authorization: `Bearer ${jwt("aal1")}` };
        const access = await handlePlatformAdminRequest(
          new Request("https://edge.test/platform-admin/access", { headers }),
        );
        assertEquals(access.status, 200);
        assertEquals(await access.json(), {
          isPlatformAdmin: true,
          sessionActive: true,
          aal: "aal1",
          mfaRequired: true,
        });
        const overview = await handlePlatformAdminRequest(
          new Request("https://edge.test/platform-admin/overview", { headers }),
        );
        assertEquals(overview.status, 403);
        assertEquals(await overview.json(), { error: "PLATFORM_MFA_REQUIRED" });
      } finally {
        globalThis.fetch = previousFetch;
      }
    }),
);

Deno.test(
  "critical mutations require a server step-up proof and stale MFA cannot mint one",
  () =>
    withRuntime(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/auth/v1/user"))
          return Promise.resolve(
            Response.json({
              id: userId,
              email: "admin@example.test",
              email_confirmed_at: new Date().toISOString(),
            }),
          );
        if (url.includes("consume_rate_limit"))
          return Promise.resolve(
            Response.json([
              { allowed: true, request_count: 1, retry_after_seconds: 0 },
            ]),
          );
        if (url.includes("platform_admin_access_state"))
          return Promise.resolve(
            Response.json({ isPlatformAdmin: true, sessionActive: true }),
          );
        return Promise.resolve(Response.json(null));
      };
      try {
        const mutation = await handlePlatformAdminRequest(
          new Request(
            "https://edge.test/platform-admin/configuration/registrations",
            {
              method: "PATCH",
              headers: {
                authorization: `Bearer ${jwt("aal2", true)}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                registrationsOpen: true,
                registrationPublicMessage: "Ouvert",
                reason: "Recette staging",
              }),
            },
          ),
        );
        assertEquals(mutation.status, 403);
        assertEquals(await mutation.json(), {
          error: "PLATFORM_STEP_UP_REQUIRED",
        });
        assertEquals(
          urls.some((url) => url.includes("platform_admin_mutate")),
          false,
        );

        const stale = await handlePlatformAdminRequest(
          new Request("https://edge.test/platform-admin/step-up", {
            method: "POST",
            headers: {
              authorization: `Bearer ${jwt("aal2")}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "settings.registrations.set",
              targetId: "global",
            }),
          }),
        );
        assertEquals(stale.status, 403);
        assertEquals(await stale.json(), {
          error: "PLATFORM_RECENT_MFA_REQUIRED",
        });
        assertEquals(
          urls.some((url) => url.includes("platform_admin_issue_step_up")),
          false,
        );
      } finally {
        globalThis.fetch = previousFetch;
      }
    }),
);

Deno.test(
  "organization email campaigns require step-up before creating recipients",
  () =>
    withRuntime(async () => {
      const previousFetch = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = (input) => {
        const url = String(input);
        urls.push(url);
        if (url.includes("/auth/v1/user"))
          return Promise.resolve(
            Response.json({
              id: userId,
              email: "admin@example.test",
              email_confirmed_at: new Date().toISOString(),
            }),
          );
        if (url.includes("consume_rate_limit"))
          return Promise.resolve(
            Response.json([
              { allowed: true, request_count: 1, retry_after_seconds: 0 },
            ]),
          );
        if (url.includes("platform_admin_access_state"))
          return Promise.resolve(
            Response.json({ isPlatformAdmin: true, sessionActive: true }),
          );
        return Promise.resolve(Response.json(null));
      };
      try {
        const response = await handlePlatformAdminRequest(
          new Request("https://edge.test/platform-admin/communications/email", {
            method: "POST",
            headers: {
              authorization: `Bearer ${jwt("aal2", true)}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              target: "all",
              organizationId: null,
              subject: "Information Eventflow",
              body: "Message de test",
              reason: "Recette de sécurité",
              idempotencyKey: "33333333-3333-4333-8333-333333333333",
            }),
          }),
        );
        assertEquals(response.status, 403);
        assertEquals(await response.json(), {
          error: "PLATFORM_STEP_UP_REQUIRED",
        });
        assertEquals(
          urls.some((url) =>
            url.includes("platform_admin_create_email_campaign"),
          ),
          false,
        );
      } finally {
        globalThis.fetch = previousFetch;
      }
    }),
);

Deno.test(
  "staging email campaign is captured and finalized without a live provider call",
  () =>
    withRuntime(async () => {
      const previousFetch = globalThis.fetch;
      const campaignId = "44444444-4444-4444-8444-444444444444";
      const deliveryId = "55555555-5555-4555-8555-555555555555";
      let captures = 0;
      let recorded = 0;
      globalThis.fetch = (input) => {
        const url = String(input);
        if (url.includes("/auth/v1/user"))
          return Promise.resolve(
            Response.json({
              id: userId,
              email: "admin@example.test",
              email_confirmed_at: new Date().toISOString(),
            }),
          );
        if (url.includes("consume_rate_limit"))
          return Promise.resolve(
            Response.json([
              { allowed: true, request_count: 1, retry_after_seconds: 0 },
            ]),
          );
        if (url.includes("platform_admin_access_state"))
          return Promise.resolve(
            Response.json({ isPlatformAdmin: true, sessionActive: true }),
          );
        if (url.includes("platform_admin_create_email_campaign"))
          return Promise.resolve(
            Response.json({
              id: campaignId,
              status: "sending",
              recipientCount: 1,
              sentCount: 0,
              failedCount: 0,
              createdAt: "2026-09-30T20:00:00.000Z",
              completedAt: null,
            }),
          );
        if (url.includes("platform_admin_email_campaign_deliveries"))
          return Promise.resolve(
            Response.json({
              id: campaignId,
              subject: "Information Eventflow",
              body: "Maintenance ce soir.",
              deliveries: [
                {
                  id: deliveryId,
                  email: "owner@example.test",
                  organizationId: "66666666-6666-4666-8666-666666666666",
                  organizationName: "Organisation test",
                },
              ],
            }),
          );
        if (url.includes("/storage/v1/object/mail-previews/")) {
          captures += 1;
          return Promise.resolve(Response.json({}));
        }
        if (url.includes("platform_admin_record_email_delivery")) {
          recorded += 1;
          return Promise.resolve(Response.json(null));
        }
        if (url.includes("platform_admin_finish_email_campaign"))
          return Promise.resolve(
            Response.json({
              id: campaignId,
              status: "completed",
              recipientCount: 1,
              sentCount: 1,
              failedCount: 0,
              createdAt: "2026-09-30T20:00:00.000Z",
              completedAt: "2026-09-30T20:00:01.000Z",
            }),
          );
        return Promise.resolve(Response.json(null));
      };
      try {
        const response = await handlePlatformAdminRequest(
          new Request("https://edge.test/platform-admin/communications/email", {
            method: "POST",
            headers: {
              authorization: `Bearer ${jwt("aal2", true)}`,
              "content-type": "application/json",
              "x-platform-step-up": "single-use-proof",
            },
            body: JSON.stringify({
              target: "organization",
              organizationId: "66666666-6666-4666-8666-666666666666",
              subject: "Information Eventflow",
              body: "Maintenance ce soir.",
              reason: "Information de maintenance",
              idempotencyKey: "77777777-7777-4777-8777-777777777777",
            }),
          }),
        );
        assertEquals(response.status, 201);
        assertEquals((await response.json()).status, "completed");
        assertEquals(captures, 1);
        assertEquals(recorded, 1);
      } finally {
        globalThis.fetch = previousFetch;
      }
    }),
);
