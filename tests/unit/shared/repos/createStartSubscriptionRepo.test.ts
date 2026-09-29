import { describe, expect, it, vi } from "vitest";
import { createStartSubscriptionRepo } from "../../../../src/app/modules/admin/subscriptions/data/startSubscriptionRepo";

function makeSupabaseInvokeMock(response: unknown) {
  return {
    functions: {
      invoke: vi.fn().mockResolvedValue(response),
    },
  };
}

function makeEdgeError(code: string) {
  return {
    context: {
      json: async () => ({ error: code }),
    },
  };
}

describe("createStartSubscriptionRepo", () => {
  it("retourne la réponse quand l'edge réussit", async () => {
    const supabase = makeSupabaseInvokeMock({
      data: {
        ok: true,
        action: "invoice",
        provider: "manual",
        orgId: "11111111-1111-4111-8111-111111111111",
        plan: "starter",
        status: "active",
        invoiceId: "22222222-2222-4222-8222-222222222222",
        invoiceNumber: "2026-000001",
        dueAt: "2026-10-12T00:00:00.000Z",
        currentPeriodEnd: "2026-10-28T00:00:00.000Z",
        reused: false,
        promoApplied: false,
        discountPercent: null,
        billingPriceValue: "15.99",
        warnings: [],
      },
      error: null,
    });

    const repo = createStartSubscriptionRepo(supabase);

    await expect(
      repo.startSubscription({
        orgId: "11111111-1111-8111-8111-111111111111",
        plan: "starter",
      }),
    ).resolves.toMatchObject({
      ok: true,
      action: "invoice",
    });

    expect(supabase.functions.invoke).toHaveBeenCalledWith("subscriptions", {
      body: {
        orgId: "11111111-1111-8111-8111-111111111111",
        plan: "starter",
      },
    });
  });

  it("remonte l'erreur edge via edgeSafe", async () => {
    const supabase = makeSupabaseInvokeMock({
      data: null,
      error: makeEdgeError("FORBIDDEN"),
    });

    const repo = createStartSubscriptionRepo(supabase);

    await expect(
      repo.startSubscription({
        orgId: "11111111-1111-8111-8111-111111111111",
        plan: "starter",
      }),
    ).rejects.toThrow("FORBIDDEN");
  });

  it("throw si l'edge renvoie une réponse vide", async () => {
    const supabase = makeSupabaseInvokeMock({
      data: null,
      error: null,
    });

    const repo = createStartSubscriptionRepo(supabase);

    await expect(
      repo.startSubscription({
        orgId: "11111111-1111-8111-8111-111111111111",
        plan: "starter",
      }),
    ).rejects.toThrow("START_SUBSCRIPTION_EMPTY_RESPONSE");
  });
});
