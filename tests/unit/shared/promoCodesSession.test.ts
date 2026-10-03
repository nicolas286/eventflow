import { describe, expect, it, vi } from "vitest";
import { createAdminPromoCodesStore } from "../../../src/app/modules/admin/promoCodes/hooks/useAdminPromoCodes";
import type { DbPromoCode } from "../../../shared/schemas/promo-codes";

const orgId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const row: DbPromoCode = {
  orgId, eventId, id, code: "WELCOME", discountPercent: 10, discountCents: null,
  maxUses: null, usedCount: 0, isActive: true, startsAt: null, endsAt: null,
  createdAt: "2026-10-03 08:00:00+02", updatedAt: "2026-10-03 08:00:00+02",
};
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(enabled = true) {
  const repo = {
    listEventPromoCodes: vi.fn(async () => [row]), createPromoCode: vi.fn(async () => row),
    updatePromoCode: vi.fn(async () => row), deletePromoCode: vi.fn(async () => undefined),
  };
  const store = createAdminPromoCodesStore(repo, { orgId, eventId }, enabled);
  return { repo, store, unsubscribe: store.subscribe(vi.fn()) };
}
describe("promo code scoped cache", () => {
  it("applies current creates, updates and deletes while preserving raw timestamps", async () => {
    const { store, repo } = fixture();
    await store.loadPromoCodes({ eventId });
    const next = { ...row, id: "44444444-4444-4444-8444-444444444444", code: "NEXT" };
    repo.createPromoCode.mockResolvedValueOnce(next);
    await store.createPromoCode({ orgId, eventId, code: "NEXT", discountPercent: 10, discountCents: null });
    expect(store.getSnapshot().promoCodes).toEqual([next, row]);
    repo.updatePromoCode.mockResolvedValueOnce({ ...row, isActive: false });
    await store.updatePromoCode({ promoCodeId: id, patch: { isActive: false } });
    expect(store.getSnapshot().promoCodes[1]).toEqual({ ...row, isActive: false });
    await store.deletePromoCode({ id });
    expect(store.getSnapshot().promoCodes).toEqual([next]);
  });

  it("keeps a newer load and ignores late data and errors", async () => {
    const { store, repo } = fixture(); const first = deferred<DbPromoCode[]>(); const second = deferred<DbPromoCode[]>();
    repo.listEventPromoCodes.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    const old = store.loadPromoCodes({ eventId }); const next = store.loadPromoCodes({ eventId });
    second.resolve([{ ...row, code: "NEW" }]); await next;
    first.reject(new Error("Old scope error")); await expect(old).resolves.toEqual([]);
    expect(store.getSnapshot()).toMatchObject({ loading: false, error: null, promoCodes: [{ ...row, code: "NEW" }] });
  });

  it("does not let a pending read replace a later successful mutation", async () => {
    const { store, repo } = fixture(); const first = deferred<DbPromoCode[]>(); repo.listEventPromoCodes.mockImplementationOnce(() => first.promise);
    const old = store.loadPromoCodes({ eventId });
    await store.createPromoCode({ orgId, eventId, code: "WELCOME", discountPercent: 10, discountCents: null });
    first.resolve([]); await expect(old).resolves.toEqual([]);
    expect(store.getSnapshot().promoCodes).toEqual([row]);
  });

  it.each(["create", "update", "delete", "load"])("reset discards a pending %s result and clears its flags", async (operation) => {
    const { store, repo } = fixture(); const response = deferred<DbPromoCode>(); const deleted = deferred<void>(); const loaded = deferred<DbPromoCode[]>();
    repo.createPromoCode.mockImplementationOnce(() => response.promise); repo.updatePromoCode.mockImplementationOnce(() => response.promise);
    repo.deletePromoCode.mockImplementationOnce(() => deleted.promise); repo.listEventPromoCodes.mockImplementationOnce(() => loaded.promise);
    const pending = operation === "create" ? store.createPromoCode({ orgId, eventId, code: "WELCOME", discountPercent: 10, discountCents: null })
      : operation === "update" ? store.updatePromoCode({ promoCodeId: id, patch: { isActive: false } })
        : operation === "delete" ? store.deletePromoCode({ id }) : store.loadPromoCodes({ eventId });
    store.reset(); response.resolve(row); deleted.resolve(); loaded.resolve([row]);
    expect(await pending).toEqual(operation === "delete" ? false : operation === "load" ? [] : null);
    expect(store.getSnapshot()).toEqual({ loading: false, saving: false, deleting: false, error: null, promoCodes: [] });
  });

  it("invalidates an unmounted store and refuses old callback mutations", async () => {
    const { store, repo, unsubscribe } = fixture(); const response = deferred<DbPromoCode>(); repo.createPromoCode.mockImplementationOnce(() => response.promise);
    const pending = store.createPromoCode({ orgId, eventId, code: "WELCOME", discountPercent: 10, discountCents: null });
    unsubscribe(); response.reject(new Error("Old identity error")); await expect(pending).resolves.toBeNull();
    await expect(store.deletePromoCode({ id })).resolves.toBe(false);
    expect(repo.deletePromoCode).not.toHaveBeenCalled(); expect(store.isCurrentScope()).toBe(false);
    expect(store.getSnapshot().error).toBeNull();
  });

  it("refuses incomplete authentication and mismatched request or response context", async () => {
    const disabled = fixture(false); await disabled.store.loadPromoCodes({ eventId }); expect(disabled.repo.listEventPromoCodes).not.toHaveBeenCalled();
    const { store, repo } = fixture(); await store.loadPromoCodes({ eventId: id }); expect(repo.listEventPromoCodes).not.toHaveBeenCalled();
    await store.createPromoCode({ orgId: id, eventId, code: "WELCOME", discountPercent: 10, discountCents: null }); expect(repo.createPromoCode).not.toHaveBeenCalled();
    repo.listEventPromoCodes.mockResolvedValueOnce([{ ...row, orgId: id }]); await store.loadPromoCodes({ eventId });
    expect(store.getSnapshot().promoCodes).toEqual([]); expect(store.getSnapshot().error).toBeTruthy();
    repo.updatePromoCode.mockResolvedValueOnce({ ...row, id: eventId });
    await expect(store.updatePromoCode({ promoCodeId: id, patch: {} })).resolves.toBeNull();
    expect(store.getSnapshot().promoCodes).toEqual([]);
  });
});
