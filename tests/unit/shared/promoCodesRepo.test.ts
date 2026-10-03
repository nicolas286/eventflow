import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminPromoCodesRepo } from "../../../src/app/modules/admin/promoCodes/data/promoCodeRepo";
import { EdgeRequestError } from "../../../src/shared/errors/edgeRequestError";

const orgId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const promoCodeId = "33333333-3333-4333-8333-333333333333";
const create = { orgId, eventId, code: "Welcome", discountPercent: 10, discountCents: null };
const row = {
  ...create, code: "WELCOME", id: promoCodeId, maxUses: null, usedCount: 0, isActive: true,
  startsAt: null, endsAt: null, createdAt: "2026-10-03 08:00:00+02", updatedAt: "2026-10-03 08:00:00+02",
};
function fixture() {
  const supabase = createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const functions = supabase.functions;
  vi.spyOn(supabase, "functions", "get").mockReturnValue(functions);
  return { supabase, invoke: vi.spyOn(functions, "invoke"), rpc: vi.spyOn(supabase, "rpc"), from: vi.spyOn(supabase, "from") };
}
describe("promo code repositories through the Edge API", () => {
  let client: ReturnType<typeof fixture>;
  beforeEach(() => { client = fixture(); });
  afterEach(() => {
    expect(client.rpc).not.toHaveBeenCalled(); expect(client.from).not.toHaveBeenCalled(); vi.restoreAllMocks();
  });

  it("lists the event codes in their server order with raw SQL timestamp values", async () => {
    client.invoke.mockResolvedValue({ data: [row], error: null });
    expect(await adminPromoCodesRepo(client.supabase).listEventPromoCodes({ eventId })).toEqual([row]);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/promos/list", { body: { eventId } });
  });

  it("creates one code with normalized legacy defaults", async () => {
    client.invoke.mockResolvedValue({ data: row, error: null });
    expect(await adminPromoCodesRepo(client.supabase).createPromoCode({ ...create, code: " welcome " })).toEqual(row);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/promos/create", { body: {
      ...create, code: "WELCOME", maxUses: null, startsAt: null, endsAt: null, isActive: true,
    } });
  });

  it("preserves nullable clearing, false activation and omission in update patches", async () => {
    client.invoke.mockResolvedValue({ data: row, error: null });
    await adminPromoCodesRepo(client.supabase).updatePromoCode({ promoCodeId, patch: { maxUses: null, endsAt: null, code: undefined, isActive: false } });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/promos/update", { body: {
      promoCodeId, patch: { maxUses: null, endsAt: null, isActive: false },
    } });
  });

  it("sends a complete discount switch without assigning its usage counter", async () => {
    client.invoke.mockResolvedValue({ data: { ...row, discountPercent: null, discountCents: 100, usedCount: 2 }, error: null });
    const result = await adminPromoCodesRepo(client.supabase).updatePromoCode({ promoCodeId, patch: { discountPercent: null, discountCents: 100 } });
    expect(result.usedCount).toBe(2);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/promos/update", { body: { promoCodeId, patch: { discountPercent: null, discountCents: 100 } } });
  });

  it.each([{}, { code: undefined }, { startsAt: undefined, maxUses: undefined }])("keeps validated empty patch reads on their separate route", async (patch) => {
    client.invoke.mockResolvedValue({ data: row, error: null });
    expect(await adminPromoCodesRepo(client.supabase).updatePromoCode({ promoCodeId, patch })).toEqual(row);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/promos/read", { body: { promoCodeId } });
  });

  it("deletes through Edge with its strict acknowledgement", async () => {
    client.invoke.mockResolvedValue({ data: { success: true }, error: null });
    await expect(adminPromoCodesRepo(client.supabase).deletePromoCode({ id: promoCodeId })).resolves.toBeUndefined();
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/promos/delete", { body: { id: promoCodeId } });
  });

  it.each([{ usedCount: 0 }, { id: promoCodeId }, { orgId }, { eventId }, { updatedAt: "2026-10-03" }])(
    "rejects forged patch fields %j", async (forged) => {
      await expect(adminPromoCodesRepo(client.supabase).updatePromoCode({ promoCodeId, patch: { code: "WELCOME", ...forged } })).rejects.toThrow();
      expect(client.invoke).not.toHaveBeenCalled();
    },
  );

  it("rejects forged envelopes, invalid dates, partial discount changes and uppercase-expanded lengths", async () => {
    const repo = adminPromoCodesRepo(client.supabase);
    const forgedCreate = { ...create, usedCount: 1 };
    const forgedList = { eventId, orgId };
    const forgedDelete = { id: promoCodeId, eventId };
    await expect(repo.createPromoCode(forgedCreate)).rejects.toThrow();
    await expect(repo.listEventPromoCodes(forgedList)).rejects.toThrow();
    await expect(repo.deletePromoCode(forgedDelete)).rejects.toThrow();
    await expect(repo.updatePromoCode({ promoCodeId, patch: { startsAt: "2026-10-03" } })).rejects.toThrow();
    await expect(repo.updatePromoCode({ promoCodeId, patch: { discountPercent: 15 } })).rejects.toThrow();
    await expect(repo.createPromoCode({ ...create, code: "ß".repeat(11) })).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "NOT_FOUND", "CONFLICT", "RESOURCE_IN_USE", "VALIDATION_ERROR"])("preserves controlled business error %s", async (code) => {
    client.invoke.mockResolvedValue({ data: null, error: { context: Response.json({ error: code }, { status: 409 }) } });
    await expect(adminPromoCodesRepo(client.supabase).deletePromoCode({ id: promoCodeId })).rejects.toThrow(code);
  });

  it.each([[429, "TOO_MANY_REQUESTS"], [503, "RATE_LIMIT_UNAVAILABLE"]])("preserves quota status %s and Retry-After", async (status, code) => {
    client.invoke.mockResolvedValue({ data: null, error: { context: Response.json({ error: code }, { status, headers: { "Retry-After": "7" } }) } });
    const pending = adminPromoCodesRepo(client.supabase).listEventPromoCodes({ eventId });
    await expect(pending).rejects.toBeInstanceOf(EdgeRequestError);
    await expect(pending).rejects.toMatchObject({ status, message: code, retryAfterSeconds: 7 });
  });

  it("rejects malformed lists, invalid discount DTOs and false mutation results", async () => {
    const repo = adminPromoCodesRepo(client.supabase);
    client.invoke.mockResolvedValue({ data: {}, error: null });
    await expect(repo.listEventPromoCodes({ eventId })).rejects.toThrow();
    client.invoke.mockResolvedValue({ data: { ...row, discountCents: 100 }, error: null });
    await expect(repo.updatePromoCode({ promoCodeId, patch: {} })).rejects.toThrow();
    client.invoke.mockResolvedValue({ data: { success: false }, error: null });
    await expect(repo.deletePromoCode({ id: promoCodeId })).rejects.toThrow();
  });
});
