import { assertEquals } from "@std/assert";
import { cancelMollieSubscription } from "../accounts/mollie.ts";

Deno.test("account deletion skips Mollie cancellation for a terminal subscription", async () => {
  const realFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    methods.push(request.method);
    return Promise.resolve(
      Response.json({ id: "sub_fixture", status: "canceled" }),
    );
  };

  try {
    assertEquals(
      await cancelMollieSubscription({
        mollieKey: "test_fixture",
        customerId: "cst_fixture",
        subscriptionId: "sub_fixture",
      }),
      { ok: true, alreadyCanceled: true },
    );
    assertEquals(methods, ["GET"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("account deletion verifies the Mollie mapping before cancellation", async () => {
  const realFetch = globalThis.fetch;
  const methods: string[] = [];
  globalThis.fetch = (input, init) => {
    const request = new Request(input, init);
    methods.push(request.method);
    return Promise.resolve(
      Response.json({ error: "not found" }, { status: 404 }),
    );
  };

  try {
    const result = await cancelMollieSubscription({
      mollieKey: "test_fixture",
      customerId: "cst_fixture",
      subscriptionId: "sub_fixture",
    });
    assertEquals(result.ok, false);
    if (!result.ok) {
      assertEquals(result.error, "MOLLIE_SUB_404_WRONG_MAPPING");
    }
    assertEquals(methods, ["GET"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
