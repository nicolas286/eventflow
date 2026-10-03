import { describe, expect, it } from "vitest";
import {
  promoCodeBaseSchema, promoCodeSchema, promoCodeValueSchema,
  promoListRequestSchema, promoCreateRequestSchema, promoUpdateRequestSchema,
  promoUpdatePatchSchema, promoUpdateOrReadRequestSchema, promoReadRequestSchema,
  promoDeleteRequestSchema, promoMutationSuccessSchema,
} from "../../../shared/schemas/promo-codes";
import { dbPromoCodeBaseSchema, dbPromoCodeSchema } from "../../../src/shared/models/db/db.promoCode.schema";
import {
  createPromoCodeInputSchema, updatePromoCodePatchSchema, updatePromoCodeInputSchema, deletePromoCodeInputSchema,
} from "../../../src/app/modules/admin/promoCodes/schemas/admin.promoCode.schema";

const orgId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const promoCodeId = "33333333-3333-4333-8333-333333333333";
const create = { orgId, eventId, code: "Welcome", discountPercent: 10, discountCents: null };

describe("promo code API contracts", () => {
  it("normalizes codes and retains legacy nullable/default create fields", () => {
    expect(promoCreateRequestSchema.parse({ ...create, code: " welcome " })).toEqual({
      ...create, code: "WELCOME", maxUses: null, startsAt: null, endsAt: null, isActive: true,
    });
    expect(promoCreateRequestSchema.parse({ ...create, isActive: false, maxUses: 1 }).isActive).toBe(false);
    expect(promoCreateRequestSchema.parse({ ...create, discountPercent: null, discountCents: 100 }).discountCents).toBe(100);
  });

  it("enforces code length after uppercase expansion", () => {
    expect(promoCodeValueSchema.parse(` ${"a".repeat(20)} `)).toBe("A".repeat(20));
    expect(promoCodeValueSchema.parse("ß".repeat(10))).toBe("SS".repeat(10));
    expect(promoCodeValueSchema.safeParse("ß".repeat(11)).success).toBe(false);
    expect(promoCodeValueSchema.safeParse(" ").success).toBe(false);
    expect(promoCodeValueSchema.safeParse("a".repeat(21)).success).toBe(false);
  });

  it.each([
    { discountPercent: null, discountCents: null },
    { discountPercent: 10, discountCents: 100 },
    { discountPercent: undefined, discountCents: 100 },
  ])("requires exactly one explicit discount type on creation %j", (discount) => {
    expect(promoCreateRequestSchema.safeParse({ ...create, ...discount }).success).toBe(false);
  });

  it.each([
    { discountPercent: 15 }, { discountCents: 100 }, { discountPercent: null },
    { discountCents: null }, { discountPercent: 15, discountCents: 100 },
    { discountPercent: null, discountCents: null },
  ])("requires both fields when a patch touches the discount %j", (patch) => {
    expect(promoUpdateRequestSchema.safeParse({ promoCodeId, patch }).success).toBe(false);
  });

  it("accepts complete discount changes and preserves absent fields and explicit nulls", () => {
    expect(promoUpdateRequestSchema.parse({ promoCodeId, patch: { discountPercent: null, discountCents: 100 } }).patch).toEqual({
      discountPercent: null, discountCents: 100,
    });
    expect(promoUpdateRequestSchema.parse({ promoCodeId, patch: { code: " welcome ", maxUses: null, startsAt: null, endsAt: null } }).patch).toEqual({
      code: "WELCOME", maxUses: null, startsAt: null, endsAt: null,
    });
    expect(promoUpdateRequestSchema.parse({ promoCodeId, patch: { isActive: false } }).patch).toEqual({ isActive: false });
  });

  it("rejects empty update writes but keeps validated legacy empty reads", () => {
    expect(promoUpdatePatchSchema.safeParse({}).success).toBe(false);
    expect(promoUpdateRequestSchema.safeParse({ promoCodeId, patch: { code: undefined } }).success).toBe(false);
    expect(promoUpdateOrReadRequestSchema.parse({ promoCodeId, patch: {} })).toEqual({ promoCodeId, patch: {} });
    expect(promoUpdateOrReadRequestSchema.parse({ promoCodeId, patch: { startsAt: undefined } }).patch).toEqual({ startsAt: undefined });
    expect(promoUpdateOrReadRequestSchema.safeParse({ promoCodeId, patch: { id: promoCodeId } }).success).toBe(false);
  });

  it("accepts ISO offset inputs and rejects reversed or identical date intervals", () => {
    const startsAt = "2026-10-03T09:00:00+02:00";
    const endsAt = "2026-10-03T10:00:00+02:00";
    expect(promoCreateRequestSchema.parse({ ...create, startsAt, endsAt })).toMatchObject({ startsAt, endsAt });
    expect(promoUpdateRequestSchema.parse({ promoCodeId, patch: { startsAt } }).patch).toEqual({ startsAt });
    expect(promoCreateRequestSchema.safeParse({ ...create, startsAt: endsAt, endsAt: startsAt }).success).toBe(false);
    expect(promoUpdateRequestSchema.safeParse({ promoCodeId, patch: { startsAt, endsAt: startsAt } }).success).toBe(false);
  });

  it.each(["not-a-date", "2026-10-03", "2026-10-03T09:00:00", "2026-02-30T09:00:00Z", "", "Infinity"])(
    "rejects invalid date input %s for create and update", (startsAt) => {
      expect(promoCreateRequestSchema.safeParse({ ...create, startsAt }).success).toBe(false);
      expect(promoUpdateRequestSchema.safeParse({ promoCodeId, patch: { startsAt } }).success).toBe(false);
    },
  );

  it.each([
    { id: promoCodeId }, { usedCount: 1 }, { createdAt: "2026-10-03" }, { updatedAt: "2026-10-03" },
  ])("rejects assigned system fields on create and update %j", (forged) => {
    expect(promoCreateRequestSchema.safeParse({ ...create, ...forged }).success).toBe(false);
    expect(promoUpdateRequestSchema.safeParse({ promoCodeId, patch: { isActive: false, ...forged } }).success).toBe(false);
  });

  it("rejects org/event reassignment, spoofed identifiers and extra envelope fields", () => {
    for (const forged of [{ eventId }, { orgId }]) {
      expect(promoUpdateRequestSchema.safeParse({ promoCodeId, patch: { isActive: false, ...forged } }).success).toBe(false);
    }
    expect(promoListRequestSchema.safeParse({ eventId, orgId }).success).toBe(false);
    expect(promoReadRequestSchema.safeParse({ promoCodeId, eventId }).success).toBe(false);
    expect(promoDeleteRequestSchema.safeParse({ id: promoCodeId, eventId }).success).toBe(false);
    expect(promoUpdateRequestSchema.safeParse({ promoCodeId, patch: { isActive: false }, id: promoCodeId }).success).toBe(false);
    expect(promoMutationSuccessSchema.safeParse({ success: true, deletedId: promoCodeId }).success).toBe(false);
  });

  it.each([
    { discountPercent: 0 }, { discountPercent: 101 }, { discountCents: 0 }, { discountCents: 100001 },
    { maxUses: 0 }, { maxUses: 100000 }, { maxUses: NaN }, { maxUses: Infinity },
  ])("rejects invalid limits or discount values %j", (invalid) => {
    expect(promoCreateRequestSchema.safeParse({ ...create, ...invalid }).success).toBe(false);
  });

  it("retains SQL output timestamp text and historic frontend aliases", () => {
    const row = {
      ...create, code: "WELCOME", id: promoCodeId, maxUses: null, usedCount: 0, isActive: true,
      startsAt: "2026-10-03 09:00:00+02", endsAt: "2026-10-03 10:00:00+02",
      createdAt: "2026-10-03 08:00:00+02", updatedAt: "2026-10-03 08:00:00+02",
    };
    expect(promoCodeSchema.parse(row)).toEqual(row);
    expect(dbPromoCodeBaseSchema).toBe(promoCodeBaseSchema); expect(dbPromoCodeSchema).toBe(promoCodeSchema);
    expect(createPromoCodeInputSchema).toBe(promoCreateRequestSchema);
    expect(updatePromoCodePatchSchema).toBe(promoUpdatePatchSchema);
    expect(deletePromoCodeInputSchema).toBe(promoDeleteRequestSchema);
    expect(updatePromoCodeInputSchema.parse({ id: promoCodeId, patch: { isActive: false } })).toEqual({ id: promoCodeId, patch: { isActive: false } });
  });
});
