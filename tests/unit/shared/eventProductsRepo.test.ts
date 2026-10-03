import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventProductRepo } from "../../../src/app/modules/admin/products/data/createEventProductRepo";
import { updateEventProductRepo } from "../../../src/app/modules/admin/products/data/updateEventProductRepo";
import { deleteEventProductRepo } from "../../../src/app/modules/admin/products/data/deleteEventProductRepo";
import { EdgeRequestError } from "../../../src/shared/errors/edgeRequestError";

const eventId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const product = {
  id: productId, eventId, name: "Ticket", priceCents: 0, currency: "EUR", stockQty: 0,
  createdAt: "2026-10-01", updatedAt: "2026-10-03", reservedQty: 0, soldQty: 0,
};
function fixture() {
  const supabase = createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const functions = supabase.functions;
  vi.spyOn(supabase, "functions", "get").mockReturnValue(functions);
  return { supabase, invoke: vi.spyOn(functions, "invoke"), rpc: vi.spyOn(supabase, "rpc"), from: vi.spyOn(supabase, "from") };
}

describe("event product repositories through the Edge API", () => {
  let client: ReturnType<typeof fixture>;
  beforeEach(() => { client = fixture(); });
  afterEach(() => {
    expect(client.rpc).not.toHaveBeenCalled(); expect(client.from).not.toHaveBeenCalled(); vi.restoreAllMocks();
  });

  it("creates one product with normalized legacy defaults while keeping zero stock", async () => {
    client.invoke.mockResolvedValue({ data: product, error: null });
    expect(await createEventProductRepo(client.supabase).createEventProduct({ eventId, name: " Ticket ", priceCents: 0, stockQty: 0 })).toEqual(product);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/products/create", {
      body: {
        eventId, name: "Ticket", priceCents: 0, stockQty: 0, currency: "EUR", description: null,
        isActive: true, sortOrder: 1, createsAttendees: true, attendeesPerUnit: 1,
        isGatekeeper: false, closeEventWhenSoldOut: false,
      },
    });
  });

  it("uses null for unlimited stock on create and preserves false custom flags", async () => {
    client.invoke.mockResolvedValue({ data: { ...product, stockQty: null }, error: null });
    const result = await createEventProductRepo(client.supabase).createEventProduct({
      eventId, name: "Ticket", priceCents: 0, stockQty: null, currency: " eur ",
      isActive: false, createsAttendees: false, isGatekeeper: true, closeEventWhenSoldOut: true,
    });
    expect(result.stockQty).toBeNull();
    expect(client.invoke).toHaveBeenLastCalledWith("events/products/create", {
      body: {
        eventId, name: "Ticket", priceCents: 0, stockQty: null, currency: "EUR", description: null,
        isActive: false, sortOrder: 1, createsAttendees: false, attendeesPerUnit: 1,
        isGatekeeper: true, closeEventWhenSoldOut: true,
      },
    });
  });

  it("updates zero stock and preserves absence of other fields", async () => {
    client.invoke.mockResolvedValue({ data: product, error: null });
    await updateEventProductRepo(client.supabase).updateEventProduct({ productId, patch: { stockQty: 0, name: undefined } });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/products/update", { body: { productId, patch: { stockQty: 0 } } });
  });

  it("preserves null clearing and normalizes currency and name in a partial patch", async () => {
    client.invoke.mockResolvedValue({ data: product, error: null });
    await updateEventProductRepo(client.supabase).updateEventProduct({ productId, patch: { stockQty: null, description: null, name: " Ticket ", currency: " eur " } });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/products/update", {
      body: { productId, patch: { stockQty: null, description: null, name: "Ticket", currency: "EUR" } },
    });
  });

  it.each([{}, { name: undefined }, { currency: undefined, stockQty: undefined }])(
    "preserves the old empty-patch read behavior through its read route", async (patch) => {
      client.invoke.mockResolvedValue({ data: product, error: null });
      expect(await updateEventProductRepo(client.supabase).updateEventProduct({ productId, patch })).toEqual(product);
      expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/products/read", { body: { productId } });
    },
  );

  it("deletes through Edge and validates its acknowledgement", async () => {
    client.invoke.mockResolvedValue({ data: { success: true }, error: null });
    await expect(deleteEventProductRepo(client.supabase).deleteEventProduct({ id: productId })).resolves.toBeUndefined();
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/products/delete", { body: { id: productId } });
  });

  it.each([{ eventId }, { soldQty: 0 }, { reservedQty: 0 }, { id: productId }, { updatedAt: "2026-10-03" }, { orgId: eventId }])(
    "rejects a moved product or assigned system field %j", async (forged) => {
      const input = { productId, patch: { name: "Ticket", ...forged } };
      await expect(updateEventProductRepo(client.supabase).updateEventProduct(input)).rejects.toThrow();
      expect(client.invoke).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid IDs and forged create/delete envelopes before requesting the API", async () => {
    await expect(updateEventProductRepo(client.supabase).updateEventProduct({ productId: "invalid", patch: {} })).rejects.toThrow();
    const create = { eventId, name: "Ticket", priceCents: 0, soldQty: 5 };
    await expect(createEventProductRepo(client.supabase).createEventProduct(create)).rejects.toThrow();
    const remove = { id: productId, eventId };
    await expect(deleteEventProductRepo(client.supabase).deleteEventProduct(remove)).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "NOT_FOUND", "CONFLICT", "RESOURCE_IN_USE", "STOCK_BELOW_ALLOCATED", "PLAN_LIMIT"])(
    "preserves controlled business error %s", async (code) => {
      client.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: code }), { status: 409 }) } });
      await expect(deleteEventProductRepo(client.supabase).deleteEventProduct({ id: productId })).rejects.toThrow(code);
    },
  );

  it.each([[429, "TOO_MANY_REQUESTS"], [503, "RATE_LIMIT_UNAVAILABLE"]])("preserves quota status %s and Retry-After", async (status, code) => {
    client.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: code }), { status, headers: { "Retry-After": "7" } }) } });
    const pending = updateEventProductRepo(client.supabase).updateEventProduct({ productId, patch: { stockQty: 0 } });
    await expect(pending).rejects.toBeInstanceOf(EdgeRequestError);
    await expect(pending).rejects.toMatchObject({ status, message: code, retryAfterSeconds: 7 });
  });

  it("rejects malformed product DTOs and false success responses", async () => {
    client.invoke.mockResolvedValue({ data: { success: false }, error: null });
    await expect(deleteEventProductRepo(client.supabase).deleteEventProduct({ id: productId })).rejects.toThrow();
    await expect(updateEventProductRepo(client.supabase).updateEventProduct({ productId, patch: {} })).rejects.toThrow();
  });
});
