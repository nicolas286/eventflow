import { assertEquals, assertRejects } from "@std/assert";
import { assertInternalEdgeAuthentication } from "../_shared/app/internal-edge/mod.ts";
import { ResponseError } from "../_shared/errors.ts";
import {
  assertWorkerAuthentication,
  WorkerAuthenticationError,
} from "../_shared/modules/worker-auth/mod.ts";

Deno.test("worker authentication accepts one exact bearer token", async () => {
  await assertWorkerAuthentication(
    new Request("https://edge.test/worker", {
      headers: { authorization: "Bearer expected-secret" },
    }),
    "expected-secret",
  );
});

Deno.test("worker authentication rejects malformed and incorrect bearers", async () => {
  for (
    const authorization of [
      null,
      "Basic expected-secret",
      "Bearer wrong-secret",
      "Bearer first second",
    ]
  ) {
    const headers = authorization ? { authorization } : undefined;
    await assertRejects(
      () =>
        assertWorkerAuthentication(
          new Request("https://edge.test/worker", { headers }),
          "expected-secret",
        ),
      WorkerAuthenticationError,
    );
  }
});

Deno.test("worker authentication rejects an empty configured secret", async () => {
  await assertRejects(
    () =>
      assertWorkerAuthentication(
        new Request("https://edge.test/worker", {
          headers: { authorization: "Bearer attacker-value" },
        }),
        "",
      ),
    WorkerAuthenticationError,
  );
});

Deno.test("internal Edge auth accepts the legacy header only when enabled", async () => {
  const request = new Request("https://edge.test/internal", {
    headers: { "x-service-token": "expected-secret" },
  });

  assertEquals(
    await assertInternalEdgeAuthentication(request, "expected-secret", {
      allowLegacyServiceToken: true,
    }),
    "legacy-x-service-token",
  );

  await assertRejects(
    () => assertInternalEdgeAuthentication(request, "expected-secret"),
    ResponseError,
    "UNAUTHORIZED",
  );
});

Deno.test("an invalid bearer cannot fall back to a valid legacy header", async () => {
  const request = new Request("https://edge.test/internal", {
    headers: {
      authorization: "Bearer wrong-secret",
      "x-service-token": "expected-secret",
    },
  });

  await assertRejects(
    () =>
      assertInternalEdgeAuthentication(request, "expected-secret", {
        allowLegacyServiceToken: true,
      }),
    ResponseError,
    "UNAUTHORIZED",
  );
});
