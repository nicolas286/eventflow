import { describe, expect, it } from "vitest";
import {
  productCreateRequestSchema, productUpdatePatchSchema, productUpdateRequestSchema,
  productReadRequestSchema, productDeleteRequestSchema,
} from "../../../shared/schemas/event-products";

const eventId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

describe("event product API contracts", () => {
  it("keeps legacy create defaults and normalizes a product name", () => {
    expect(productCreateRequestSchema.parse({ eventId, name: " Ticket ", priceCents: 0 })).toEqual({
      eventId, name: "Ticket", priceCents: 0, currency: "EUR", description: null, stockQty: null,
      isActive: true, sortOrder: 1, createsAttendees: true, attendeesPerUnit: 1,
      isGatekeeper: false, closeEventWhenSoldOut: false,
    });
  });

  it("preserves sold-out zero stock separately from unlimited null stock", () => {
    expect(productCreateRequestSchema.parse({ eventId, name: "Ticket", priceCents: 0, stockQty: 0 }).stockQty).toBe(0);
    expect(productCreateRequestSchema.parse({ eventId, name: "Ticket", priceCents: 0, stockQty: null }).stockQty).toBeNull();
    expect(productUpdateRequestSchema.parse({ productId, patch: { stockQty: 0 } }).patch).toEqual({ stockQty: 0 });
    expect(productUpdateRequestSchema.parse({ productId, patch: { stockQty: null } }).patch).toEqual({ stockQty: null });
  });

  it("does not add create defaults to partial updates and preserves explicit nulls", () => {
    expect(productUpdateRequestSchema.parse({ productId, patch: { name: " Renamed ", description: null } })).toEqual({
      productId, patch: { name: "Renamed", description: null },
    });
    expect(productUpdatePatchSchema.parse({})).toEqual({});
    expect(productUpdateRequestSchema.safeParse({ productId, patch: {} }).success).toBe(false);
  });

  it("accepts normalized EUR and rejects other currencies", () => {
    expect(productCreateRequestSchema.parse({ eventId, name: "Ticket", priceCents: 100, currency: " eur " }).currency).toBe("EUR");
    expect(productUpdateRequestSchema.parse({ productId, patch: { currency: " eur " } }).patch.currency).toBe("EUR");
    expect(productCreateRequestSchema.safeParse({ eventId, name: "Ticket", priceCents: 100, currency: "USD" }).success).toBe(false);
    expect(productUpdateRequestSchema.safeParse({ productId, patch: { currency: "GBP" } }).success).toBe(false);
  });

  it.each([NaN, Infinity, -1, 1.5, 1_000_001])("rejects invalid stock %s", (stockQty) => {
    expect(productCreateRequestSchema.safeParse({ eventId, name: "Ticket", priceCents: 0, stockQty }).success).toBe(false);
    expect(productUpdateRequestSchema.safeParse({ productId, patch: { stockQty } }).success).toBe(false);
  });

  it.each([{ id: productId }, { soldQty: 0 }, { reservedQty: 0 }, { createdAt: "2026-10-03" }, { orgId: eventId }])(
    "rejects assigned system field %j on creates and updates", (forged) => {
      expect(productCreateRequestSchema.safeParse({ eventId, name: "Ticket", priceCents: 0, ...forged }).success).toBe(false);
      expect(productUpdateRequestSchema.safeParse({ productId, patch: { name: "Ticket", ...forged } }).success).toBe(false);
    },
  );

  it("rejects moving a product to another event and ambiguous identifiers", () => {
    expect(productUpdateRequestSchema.safeParse({ productId, patch: { eventId } }).success).toBe(false);
    expect(productReadRequestSchema.safeParse({ productId, eventId }).success).toBe(false);
    expect(productDeleteRequestSchema.safeParse({ id: productId, eventId }).success).toBe(false);
    expect(productReadRequestSchema.parse({ productId })).toEqual({ productId });
    expect(productDeleteRequestSchema.parse({ id: productId })).toEqual({ id: productId });
  });

  it("rejects whitespace-only product names", () => {
    expect(productCreateRequestSchema.safeParse({ eventId, name: "   ", priceCents: 0 }).success).toBe(false);
    expect(productUpdateRequestSchema.safeParse({ productId, patch: { name: " a " } }).success).toBe(false);
  });
});
