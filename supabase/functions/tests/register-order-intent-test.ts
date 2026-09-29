import { assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ResponseError } from "../_shared/errors.ts";
import { createOrderIntentOrThrow } from "../orders/public/order-intent-repository.ts";
import type { CreateOrderIntentArgs } from "../orders/public/registerTickets.contracts.ts";

const args: CreateOrderIntentArgs = {
  p_event_id: "11111111-1111-4111-8111-111111111111",
  p_items: [{
    event_product_id: "22222222-2222-4222-8222-222222222222",
    quantity: 1,
  }],
  p_attendees: [],
  p_buyer: { email: "synthetic@example.test" },
  p_rate_key: "hashed-rate-limit-key",
  p_promo_code: null,
};

function rpcClient(result: { data: unknown; error: unknown }) {
  return {
    rpc: () => Promise.resolve(result),
  } as unknown as Pick<SupabaseClient, "rpc">;
}

Deno.test("order intent repository preserves the successful result", async () => {
  const result = await createOrderIntentOrThrow({
    admin: rpcClient({
      data: {
        order_id: "33333333-3333-4333-8333-333333333333",
        booking_token: "synthetic-booking-token",
        payment_required: true,
        total_cents: 2500,
        discount_cents: 500,
        promo_code_id: null,
        amount_due_now_cents: 2000,
        currency: "EUR",
      },
      error: null,
    }),
    args,
  });

  assertEquals(result, {
    orderId: "33333333-3333-4333-8333-333333333333",
    bookingToken: "synthetic-booking-token",
    paymentRequired: true,
    totalCents: 2500,
    discountCents: 500,
    promoCodeId: null,
    dueNowCents: 2000,
    currency: "EUR",
  });
});

Deno.test("order intent repository preserves mapped business errors", async () => {
  const originalError = console.error;
  console.error = () => {};

  try {
    const error = await assertRejects(() =>
      createOrderIntentOrThrow({
        admin: rpcClient({
          data: null,
          error: { code: "P0001", message: "PROMO_CODE_EXPIRED" },
        }),
        args,
      })
    );

    assertInstanceOf(error, ResponseError);
    assertEquals(error.status, 409);
    assertEquals(error.code, "PROMO_CODE_EXPIRED");
  } finally {
    console.error = originalError;
  }
});
