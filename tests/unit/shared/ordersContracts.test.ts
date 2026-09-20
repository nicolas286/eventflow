import { describe, expect, it } from "vitest";
import { registerPayloadSchema } from "../../../shared/schemas/orders-public";
import { adminRegisterPayloadSchema } from "../../../shared/schemas/orders-admin";
import { orderPublicSchema, bookingTokenSchema } from "../../../shared/schemas/orders-read";

const eventId = "11111111-1111-4111-8111-111111111111";
const eventProductId = "22222222-2222-4222-8222-222222222222";
const base = {
  eventId, items: [{ eventProductId, quantity: 1 }],
  attendees: [{ eventProductId, answers: [] }], buyer: { email: "qa@example.com" },
};

describe("shared order boundary contracts", () => {
  it.each(["pending", "awaiting_payment", "partially_paid", "paid", "cancelled", "expired"])("preserves SQL order status %s", (status) => {
    const result = orderPublicSchema.parse({ id: eventId, status, totalCents: null, currency: null, paymentStatus: null });
    expect(result.status).toBe(status);
  });
  it("public checkout requires captcha and rejects admin payment controls", () => {
    expect(registerPayloadSchema.safeParse(base).success).toBe(false);
    expect(registerPayloadSchema.safeParse({ ...base, turnstileToken: "captcha" }).success).toBe(true);
    expect(registerPayloadSchema.safeParse({ ...base, turnstileToken: "captcha", markPaid: true }).success).toBe(false);
  });
  it("preserves attendee, buyer and quantity constraints", () => {
    expect(adminRegisterPayloadSchema.safeParse({ ...base, attendees: [] }).success).toBe(false);
    expect(adminRegisterPayloadSchema.safeParse({ ...base, buyer: {} }).success).toBe(false);
    expect(registerPayloadSchema.safeParse({ ...base, turnstileToken: "captcha", items: [{ eventProductId, quantity: 101 }] }).success).toBe(false);
  });
  it("admin offline input remains independent from public checkout", () => {
    expect(adminRegisterPayloadSchema.safeParse({ ...base, markPaid: true, payMode: "full" }).success).toBe(true);
    expect(adminRegisterPayloadSchema.safeParse({ ...base, turnstileToken: "captcha" }).success).toBe(false);
  });
  it("validates the public response and booking token", () => {
    expect(orderPublicSchema.safeParse({ id: eventId, status: "paid", totalCents: 2000, currency: "EUR", paymentStatus: "paid" }).success).toBe(true);
    expect(bookingTokenSchema.safeParse(" ").success).toBe(false);
    expect(bookingTokenSchema.safeParse("a".repeat(2049)).success).toBe(false);
  });
});
