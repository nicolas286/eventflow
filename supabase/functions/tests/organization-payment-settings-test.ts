import { assertEquals } from "@std/assert";
import { handleOrganizationPaymentSettingsRequest } from "../organization-payment-settings/index.ts";

const orgId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

async function withRuntime(run: () => Promise<void>) {
  const values: Record<string, string> = {
    SUPABASE_URL: "https://payment-settings-fixture.supabase.co",
    RATE_LIMIT_SALT: "fixture-a8-salt",
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
  };
  const previous = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  for (const [key, value] of Object.entries(values)) Deno.env.set(key, value);
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

function request(body: unknown, authenticated = true) {
  return new Request("https://edge.test/organization-payment-settings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: "Bearer fixture-user" } : {}),
    },
    body: JSON.stringify(body),
  });
}

Deno.test(
  "payment settings require an authenticated organization manager",
  () =>
    withRuntime(async () => {
      const response = await handleOrganizationPaymentSettingsRequest(
        request({ action: "read", orgId }, false),
      );
      assertEquals(response.status, 401);
    }),
);
Deno.test("another organization user cannot read or mutate bank details", () =>
  withRuntime(async () => {
    const previousFetch = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (input) => {
      const url = String(input);
      urls.push(url);
      const data = url.includes("/auth/v1/user")
        ? { id: userId, email: "outsider@example.test" }
        : null;
      return Promise.resolve(Response.json(data));
    };

    try {
      const response = await handleOrganizationPaymentSettingsRequest(
        request({
          action: "update",
          orgId,
          paymentsProvider: "stripe",
          bankTransferBeneficiary: null,
          bankTransferIban: null,
        }),
      );
      assertEquals(response.status, 403);
      assertEquals(
        urls.some((url) =>
          url.includes("update_organization_payment_settings")
        ),
        false,
      );
    } finally {
      globalThis.fetch = previousFetch;
    }
  }));

Deno.test("an organization manager can explicitly reveal bank details", () =>
  withRuntime(async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (input) => {
      const url = String(input);
      if (url.includes("/rpc/consume_rate_limit")) {
        return Promise.resolve(
          Response.json([{
            allowed: true,
            request_count: 1,
            retry_after_seconds: 0,
          }]),
        );
      }
      const data = url.includes("/auth/v1/user")
        ? { id: userId, email: "admin@example.test" }
        : url.includes("/organization_members?")
        ? { role: "admin" }
        : url.includes("/organizations?")
        ? {
          id: orgId,
          payments_provider: "bank_transfer",
          bank_transfer_beneficiary: "Eventflow ASBL",
          bank_transfer_iban: "BE51732081025262",
        }
        : null;
      return Promise.resolve(Response.json(data));
    };

    try {
      const response = await handleOrganizationPaymentSettingsRequest(
        request({ action: "read", orgId }),
      );
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.bankTransferIban, "BE51732081025262");
      assertEquals(body.bankTransferIbanMasked, "BE•• •••• •••• 5262");
    } finally {
      globalThis.fetch = previousFetch;
    }
  }));

Deno.test("an organization manager can accept the default sales terms", () =>
  withRuntime(async () => {
    const previousFetch = globalThis.fetch;
    const terms = "# Conditions\n\n" + "Conditions organisateur. ".repeat(12);
    globalThis.fetch = (input, init) => {
      const url = String(input);
      if (url.includes("/rpc/organizer_accept_organization_sales_terms")) {
        assertEquals(
          new Headers(init?.headers).get("authorization"),
          "Bearer fixture-service",
        );
        const payload: unknown = JSON.parse(String(init?.body));
        assertEquals(payload, {
          p_actor_id: userId,
          p_org_id: orgId,
          p_sales_terms: terms.trim(),
        });
      }
      if (url.includes("/rpc/consume_rate_limit")) {
        return Promise.resolve(
          Response.json([{
            allowed: true,
            request_count: 1,
            retry_after_seconds: 0,
          }]),
        );
      }
      const data = url.includes("/auth/v1/user")
        ? { id: userId, email: "admin@example.test" }
        : url.includes("/organization_members?")
        ? { role: "admin" }
        : url.includes("/rpc/organizer_accept_organization_sales_terms")
        ? {
          orgId,
          paymentsProvider: "stripe",
          bankTransferBeneficiary: null,
          bankTransferIban: null,
          bankTransferIbanMasked: null,
          salesTerms: terms,
          salesTermsVersion: "default-2026-09-29",
          salesTermsAcceptedVersion: "default-2026-09-29",
          salesTermsAcceptedAt: "2026-09-29T12:00:00.000Z",
          salesTermsAcceptedBy: userId,
          salesTermsCurrent: true,
        }
        : null;
      return Promise.resolve(Response.json(data));
    };

    try {
      const response = await handleOrganizationPaymentSettingsRequest(
        request({
          action: "accept_terms",
          orgId,
          salesTerms: terms,
          confirmed: true,
        }),
      );
      assertEquals(response.status, 200);
      const body = await response.json();
      assertEquals(body.salesTermsCurrent, true);
      assertEquals(body.salesTermsAcceptedBy, userId);
    } finally {
      globalThis.fetch = previousFetch;
    }
  }));
