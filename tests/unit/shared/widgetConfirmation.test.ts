import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readCachedWidgetConfirmation,
  resolveWidgetOrderCredentials,
} from "../../../src/app/modules/public/widget/helpers/widgetConfirmation";
import { fetchWidgetConfirmationOrder } from "../../../src/app/modules/public/widget/data/widgetConfirmationRepo";

const orderId = "10000000-0000-4000-8000-000000000001";
const otherOrderId = "20000000-0000-4000-8000-000000000002";
const cached = {
  orderId,
  bookingToken: "synthetic-cached-token",
  eventTitle: "Fixture event",
  buyerEmail: "buyer@example.invalid",
  totalTickets: 1,
};

afterEach(() => vi.unstubAllGlobals());

describe("widget confirmation credentials", () => {
  it("reads cached credentials but excludes stale financial status and instructions", () => {
    const result = readCachedWidgetConfirmation(JSON.stringify({
      ...cached,
      status: "awaiting_payment",
      bankTransfer: { iban: "obsolete" },
      totalCents: 1234,
    }));
    expect(result).toEqual(cached);
    expect(resolveWidgetOrderCredentials(null, null, result)).toEqual({
      orderId, token: cached.bookingToken,
    });
  });

  it("uses the complete URL pair when a different order is cached", () => {
    expect(resolveWidgetOrderCredentials(otherOrderId, "synthetic-url-token", cached)).toEqual({
      orderId: otherOrderId, token: "synthetic-url-token",
    });
  });

  it.each([
    [otherOrderId, null],
    [orderId, null],
    [null, "synthetic-url-token"],
    [otherOrderId, ""],
    ["invalid-id", "synthetic-url-token"],
  ])("never fills an incomplete or invalid URL from cached credentials (%s)", (id, token) => {
    expect(resolveWidgetOrderCredentials(id, token, cached)).toBeNull();
  });

  it("rejects malformed storage without crashing", () => {
    expect(readCachedWidgetConfirmation("{not-json")).toBeNull();
    expect(readCachedWidgetConfirmation(JSON.stringify({ ...cached, items: [{}] }))).toBeNull();
    expect(resolveWidgetOrderCredentials(null, null, null)).toBeNull();
  });
});

describe("widget confirmation repository", () => {
  it("loads current server status with the matching token and disables browser caching", async () => {
    const body = { id: orderId, status: "paid", totalCents: 1500, currency: "EUR", paymentStatus: "paid", paymentMethod: "bank_transfer", bankTransfer: null };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await fetchWidgetConfirmationOrder({ orderId, token: "synthetic token" }, signal)).toEqual(body);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/orders/${orderId}?token=synthetic%20token`),
      expect.objectContaining({ cache: "no-store", signal }),
    );
  });

  it.each([401, 403, 404, 500])("rejects HTTP %s without using cached instructions", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
    await expect(fetchWidgetConfirmationOrder({ orderId, token: cached.bookingToken }, new AbortController().signal)).rejects.toThrow("order_fetch_failed");
  });

  it("rejects a response for a different order", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: otherOrderId, status: "awaiting_payment", totalCents: 1500, currency: "EUR", paymentStatus: "pending",
    }))));
    await expect(fetchWidgetConfirmationOrder({ orderId, token: cached.bookingToken }, new AbortController().signal)).rejects.toThrow("order_mismatch");
  });
});
