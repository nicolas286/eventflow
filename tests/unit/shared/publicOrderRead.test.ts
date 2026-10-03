import { afterEach, describe, expect, it, vi } from "vitest";
import { readPublicOrder } from "../../../src/shared/gateways/supabase/repositories/readPublicOrder";
import { fetchWidgetConfirmationOrder } from "../../../src/app/modules/public/widget/data/widgetConfirmationRepo";

const id = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.unstubAllGlobals());
describe("shared public order reader", () => {
  it.each(["cancelled", "canceled"])("normalizes %s for page and widget", async (status) => {
    const fetchMock = vi.fn(async () => Response.json({ id, status, totalCents: null, currency: null, paymentStatus: null }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await readPublicOrder(id, "fixture-token")).status).toBe("canceled");
    const signal = new AbortController().signal;
    expect((await fetchWidgetConfirmationOrder({ orderId: id, token: "fixture-token" }, signal)).status).toBe("canceled");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ signal, cache: "no-store" });
  });
  it("rejects a response for another order", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ id: "22222222-2222-4222-8222-222222222222", status: "paid", totalCents: 0, currency: "EUR", paymentStatus: null }));
    await expect(readPublicOrder(id, "fixture-token")).rejects.toThrow("order_mismatch");
  });
});
