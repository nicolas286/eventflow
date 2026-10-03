import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { makeInvoiceListRepo } from "../../../src/app/modules/admin/subscriptions/data/makeInvoiceListRepo";
import { EdgeRequestError } from "../../../src/shared/errors/edgeRequestError";
import type { InvoiceHistoryResponse } from "../../../shared/schemas/invoice-history";

const orgId = "11111111-1111-4111-8111-111111111111";
const foreignOrgId = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const item = {
  id, number: "FIX-001", status: "issued", issuedAt: "2026-10-02T08:00:00Z",
  totalCents: 1500, dueAt: null, paymentReference: null,
};
const response: InvoiceHistoryResponse = {
  orgId, items: [{ ...item, status: "issued" }], nextCursor: { id, issuedAt: item.issuedAt },
};

function setup(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...headers },
  }));
  const client = createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return { repo: makeInvoiceListRepo(client), fetch };
}

describe("invoice history repository through the actual Supabase functions SDK", () => {
  it("uses only the Edge route and transmits validated input and cursor", async () => {
    const { repo, fetch } = setup(response);
    const cursor = { id, issuedAt: item.issuedAt };
    await expect(repo.listInvoices({ orgId, limit: 10, cursor })).resolves.toEqual(response);
    expect(fetch).toHaveBeenCalledOnce();
    const call = fetch.mock.calls[0];
    expect(call?.[0]).toBe("https://fixture.example.invalid/functions/v1/invoices/list");
    expect(call?.[1]?.method).toBe("POST");
    const requestBody = call?.[1]?.body;
    if (typeof requestBody !== "string") throw new Error("Expected a JSON request body");
    expect(JSON.parse(requestBody)).toEqual({ orgId, limit: 10, cursor });
    expect(fetch.mock.calls.every(([url]) => String(url).includes("/functions/v1/invoices/list"))).toBe(true);
  });

  it("preserves empty results and nullable timestamp cursor", async () => {
    const empty = setup({ orgId, items: [], nextCursor: null });
    await expect(empty.repo.listInvoices({ orgId, limit: 25, cursor: null })).resolves.toEqual({ orgId, items: [], nextCursor: null });
    expect(empty.fetch.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ orgId, limit: 25, cursor: null }));
    const undated = setup({ orgId, items: [{ ...item, issuedAt: null }], nextCursor: { id, issuedAt: null } });
    await expect(undated.repo.listInvoices({ orgId, limit: 1, cursor: { id, issuedAt: null } })).resolves.toMatchObject({ nextCursor: { id, issuedAt: null } });
  });

  it("refuses invalid input before sending a request", async () => {
    const { repo, fetch } = setup(response);
    for (const input of [{ orgId: "invalid", limit: 25 }, { orgId, limit: 0 }, { orgId, limit: 101 }, { orgId, limit: 1, cursor: { id, issuedAt: "invalid" } }]) {
      await expect(repo.listInvoices(input)).rejects.toBeInstanceOf(ZodError);
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a response for another organization", async () => {
    const { repo } = setup({ ...response, orgId: foreignOrgId });
    await expect(repo.listInvoices({ orgId, limit: 25 })).rejects.toThrow("FORBIDDEN");
  });

  it("rejects malformed responses and leaked DB fields", async () => {
    for (const body of [
      { ...response, items: [{ ...item, totalCents: -1 }] },
      { ...response, items: [{ ...item, status: "unknown" }] },
      { ...response, items: [{ ...item, org_id: orgId, provider_invoice_id: "synthetic-private-id" }] },
      { ...response, nextCursor: { id: "invalid", issuedAt: null } },
    ]) {
      const { repo } = setup(body);
      await expect(repo.listInvoices({ orgId, limit: 25 })).rejects.toBeInstanceOf(ZodError);
    }
  });

  it("keeps an authorization failure useful to callers", async () => {
    const { repo } = setup({ error: "FORBIDDEN" }, 403);
    await expect(repo.listInvoices({ orgId, limit: 25 })).rejects.toThrow("FORBIDDEN");
  });

  it.each([429, 503])("preserves controlled HTTP %s quota errors and Retry-After", async (status) => {
    const { repo } = setup({ error: status === 429 ? "TOO_MANY_REQUESTS" : "RATE_LIMIT_UNAVAILABLE" }, status, { "Retry-After": "7" });
    await expect(repo.listInvoices({ orgId, limit: 25 })).rejects.toEqual(new EdgeRequestError(status === 429 ? 429 : 503, 7));
  });

  it("translates expired sessions and server failures without exposing codes or raw details", async () => {
    const expired = setup({ error: "UNAUTHORIZED" }, 401);
    await expect(expired.repo.listInvoices({ orgId, limit: 25 })).rejects.toThrow("Tu dois être connecté");
    for (const failure of ["INVOICE_HISTORY_LOAD_FAILED", "synthetic-private-database-detail"]) {
      const { repo } = setup({ error: failure }, 500);
      await expect(repo.listInvoices({ orgId, limit: 25 })).rejects.toThrow("Impossible de charger les factures. Réessayez dans quelques instants.");
    }
  });
});
