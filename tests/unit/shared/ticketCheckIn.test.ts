import { createScopedEventMutationStore } from "../../../src/app/modules/admin/singleEvent/hooks/useScopedEventMutation";
import { afterEach, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { markTicketCheckedInRepo } from "../../../src/app/modules/admin/orders/data/markTicketChekedInRepo";
import { markTicketCheckedInByQrRepo } from "../../../src/app/modules/admin/orders/data/markTicketCheckedInByQrRepo";
import { makeEventTicketsAdminRepo } from "../../../src/app/modules/admin/singleEvent/data/makeEventTicketsRepo";
import {
  ticketCheckInRequestSchema,
  ticketQrCheckInRequestSchema,
  ticketsListRequestSchema,
} from "../../../shared/schemas/ticket-check-in";
const id = "b4200000-0000-4000-8000-000000000001";
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const client = createClient("https://b4.invalid", "synthetic-public", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const functions = client.functions;
  vi.spyOn(client, "functions", "get").mockReturnValue(functions);
  return {
    client,
    invoke: vi.spyOn(functions, "invoke"),
    rpc: vi.spyOn(client, "rpc"),
  };
}
it("uses only the three declared Edge routes and preserves ticket DTO", async () => {
  const f = fixture(),
    result = {
      ok: true,
      outcome: "validated",
      ticketId: id,
      eventId: id,
      orderId: id,
      ticketIndex: 1,
      qrToken: "synthetic-qr",
      status: "checked_in",
      checkedInAt: "2026-10-03T12:00:00Z",
      checkedInBy: id,
    };
  f.invoke.mockResolvedValue({ data: result, error: null });
  expect(
    await markTicketCheckedInRepo(f.client).markTicketCheckedIn({
      ticketId: id,
      eventId: id,
    }),
  ).toEqual(result);
  expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/ticket-check-in", {
    body: { ticketId: id, eventId: id },
  });
  await markTicketCheckedInByQrRepo(f.client).markTicketCheckedInByQr({
    qrToken: " synthetic-qr ",
    eventId: id,
  });
  expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/ticket-check-in-qr", {
    body: { qrToken: "synthetic-qr", eventId: id },
  });
  f.invoke.mockResolvedValue({
    data: { tickets: { limit: 25, offset: 50, total: 0, rows: [] } },
    error: null,
  });
  await makeEventTicketsAdminRepo(f.client).getEventTicketsAdmin({
    eventId: id,
    limit: 25,
    offset: 50,
  });
  expect(f.invoke).toHaveBeenLastCalledWith("orders/admin/tickets-list", {
    body: { eventId: id, limit: 25, offset: 50 },
  });
  expect(f.rpc).not.toHaveBeenCalled();
});
it.each([403, 429, 503])(
  "propagates Edge %i for scans without RPC fallback",
  async (status) => {
    const f = fixture();
    f.invoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "safe",
        context: new Response(JSON.stringify({ error: "FORBIDDEN" }), {
          status,
        }),
      },
    });
    await expect(
      markTicketCheckedInRepo(f.client).markTicketCheckedIn({
        ticketId: id,
        eventId: id,
      }),
    ).rejects.toThrow();
    await expect(
      markTicketCheckedInByQrRepo(f.client).markTicketCheckedInByQr({
        qrToken: "qr",
        eventId: id,
      }),
    ).rejects.toThrow();
    expect(f.rpc).not.toHaveBeenCalled();
  },
);
it("rejects forged actor/system properties and unbounded inputs", () => {
  expect(
    ticketCheckInRequestSchema.safeParse({
      ticketId: id,
      eventId: id,
      checkedInBy: id,
    }).success,
  ).toBe(false);
  expect(
    ticketQrCheckInRequestSchema.safeParse({
      qrToken: "x".repeat(2049),
      eventId: id,
    }).success,
  ).toBe(false);
  expect(
    ticketsListRequestSchema.safeParse({ eventId: id, offset: 10000001 })
      .success,
  ).toBe(false);
});

it("discards a pending scan after session/event abandonment", async () => {
  let resolve: (value: string) => void = () => {};
  const store = createScopedEventMutationStore(
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
    "Scan failed",
    true,
    true,
  );
  const off = store.subscribe(() => {}), pending = store.mutate("old-scope");
  off();
  resolve("validated-old-scope");
  expect(await pending).toBeNull();
  expect(store.getSnapshot().result).toBeNull();
  expect(store.getSnapshot().loading).toBe(false);
});
it("rejects malformed scan DTOs without a direct fallback", async () => {
  const f = fixture();
  f.invoke.mockResolvedValue({
    data: { ok: true, checkedInBy: "client-forgery" },
    error: null,
  });
  await expect(
    markTicketCheckedInRepo(f.client).markTicketCheckedIn({
      ticketId: id,
      eventId: id,
    }),
  ).rejects.toThrow();
  expect(f.rpc).not.toHaveBeenCalled();
});
