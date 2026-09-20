import { describe, expect, it, vi } from "vitest";
import { createRegisterRepo } from "../../../../src/app/modules/public/register/data/registerRepo";

function makeSupabaseInvokeMock(response: unknown) {
  return {
    functions: {
      invoke: vi.fn().mockResolvedValue(response),
    },
  } as any;
}

function makeEdgeError(code: string) {
  return {
    context: {
      json: async () => ({ error: code }),
    },
  };
}

const validPayload = {
  eventId: "11111111-1111-4111-8111-111111111111",
  items: [
    {
      eventProductId: "22222222-2222-4222-8222-222222222222",
      quantity: 1,
    },
  ],
  attendees: [
    {
      eventProductId: "22222222-2222-4222-8222-222222222222",
      answers: [],
    },
  ],
  buyer: {
    email: "jean@example.com",
    name: "Jean Dupont",
    phone: "0470000000",
    isAttendee: true,
  },
  turnstileToken: "test-token",
  checkoutSource: "public",
};

describe("createRegisterRepo", () => {
  it("throw si le payload est invalide", async () => {
    const supabase = makeSupabaseInvokeMock({
      data: null,
      error: null,
    });

    const repo = createRegisterRepo(supabase);

    await expect(repo.register({})).rejects.toThrow("INVALID_REGISTER_PAYLOAD");

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });

  it("retourne la réponse quand l'edge réussit", async () => {
    const supabase = makeSupabaseInvokeMock({
      data: {
        ok: true,
        orderId: "33333333-3333-4333-8333-333333333333",
        status: "awaiting_payment",
        checkoutUrl: "https://example.com/checkout",
        amountDueNowCents: 1599,
        totalCents: 1599,
        reusedPayment: false,
        bookingToken: "booking-token",
      },
      error: null,
    });

    const repo = createRegisterRepo(supabase);

    await expect(repo.register(validPayload)).resolves.toMatchObject({
      ok: true,
      status: "awaiting_payment",
      checkoutUrl: "https://example.com/checkout",
    });

    expect(supabase.functions.invoke).toHaveBeenCalledWith("orders", {
      body: validPayload,
    });
  });

  it("remonte l'erreur edge via edgeSafe", async () => {
    const supabase = makeSupabaseInvokeMock({
      data: null,
      error: makeEdgeError("EVENT_NOT_FOUND"),
    });

    const repo = createRegisterRepo(supabase);

    await expect(repo.register(validPayload)).rejects.toThrow("EVENT_NOT_FOUND");
  });

  it("throw si l'edge renvoie une réponse vide", async () => {
    const supabase = makeSupabaseInvokeMock({
      data: null,
      error: null,
    });

    const repo = createRegisterRepo(supabase);

    await expect(repo.register(validPayload)).rejects.toThrow("REGISTER_EMPTY_RESPONSE");
  });
});