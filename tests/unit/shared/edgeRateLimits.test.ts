import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { edgeSafe } from "../../../src/shared/gateways/supabase/supabaseEdgeSafe";
import { EdgeRequestError, readEdgeRequestError } from "../../../src/shared/errors/edgeRequestError";
import { normalizeError } from "../../../src/shared/errors/errors";
import { stripeConnectRepo } from "../../../src/app/modules/admin/payments/data/stripeConnectRepo";
import { fetchWidgetConfirmationOrder } from "../../../src/app/modules/public/widget/data/widgetConfirmationRepo";

const orgId = "10000000-0000-4000-8000-000000000001";
function limited(status = 429, retryAfter = "17") {
  return new Response(JSON.stringify({ error: status === 429 ? "TOO_MANY_REQUESTS" : "RATE_LIMIT_UNAVAILABLE", details: "synthetic-private-token" }), {
    status, headers: { "Content-Type": "application/json", "Retry-After": retryAfter },
  });
}
afterEach(() => vi.unstubAllGlobals());

describe("Edge rate limit clients with the real Supabase SDK", () => {
  it.each([
    "stripe-connect-start", "stripe-connect-status", "organization-payment-settings",
    "subscriptions", "invoices/fixture/pdf", "orders/admin", "platform-config?audience=public",
  ])("preserves 429 metadata from %s without retrying or exposing HTTP context", async (route) => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => limited());
    const client = createClient("https://fixture.example.invalid", "synthetic-key", {
      global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
    });
    let captured: unknown;
    try {
      await edgeSafe(() => client.functions.invoke(route));
    } catch (error) { captured = error; }
    expect(captured).toBeInstanceOf(EdgeRequestError);
    expect(captured).toMatchObject({ status: 429, message: "TOO_MANY_REQUESTS", retryAfterSeconds: 17 });
    expect(captured).not.toHaveProperty("cause");
    expect(captured).not.toHaveProperty("context");
    expect(fetch).toHaveBeenCalledOnce();
    const normalized = normalizeError(captured, "fallback");
    expect(normalized.message).toBe("Trop de demandes. Réessayez dans 17 secondes.");
    expect(normalized.meta).toMatchObject({ status: 429, retryAfterSeconds: 17 });
    expect(JSON.stringify(normalized)).not.toContain("synthetic-private-token");
  });

  it("Stripe status surfaces 503 as temporary unavailability, not exhausted quota", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => limited(503, "30"));
    const client = createClient("https://fixture.example.invalid", "synthetic-key", {
      global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
    });
    await expect(stripeConnectRepo(client).status({ orgId })).rejects.toMatchObject({
      message: "RATE_LIMIT_UNAVAILABLE", status: 503, retryAfterSeconds: 30,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("public order throttling", () => {
  it("the widget preserves Retry-After and never retains a booking token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => limited());
    vi.stubGlobal("fetch", fetch);
    let captured: unknown;
    try {
      await fetchWidgetConfirmationOrder({ orderId: orgId, token: "synthetic-private-token" }, new AbortController().signal);
    } catch (error) { captured = error; }
    expect(captured).toMatchObject({ message: "TOO_MANY_REQUESTS", retryAfterSeconds: 17 });
    expect(JSON.stringify(captured)).not.toContain("synthetic-private-token");
    expect(captured).not.toHaveProperty("cause");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["", "0", "-1", "abc", "1.5", "999999999999999999999999"])("uses an explicit safe delay when Retry-After is invalid (%s)", async (raw) => {
    expect(await readEdgeRequestError(limited(429, raw))).toMatchObject({ retryAfterSeconds: 60 });
    expect(await readEdgeRequestError(limited(503, raw))).toMatchObject({ retryAfterSeconds: 30 });
  });
  it("does not mistake an unrelated HTTP 503 for a limiter outage", async () => {
    expect(await readEdgeRequestError(new Response("{}", { status: 503 }))).toBeNull();
  });
});
