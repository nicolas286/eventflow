import { assert, assertEquals, assertRejects } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { consumeRequestRateLimit } from "../_shared/app/rate-limit/mod.ts";
import {
  consumeRateLimit,
  hashRateLimitKey,
} from "../_shared/modules/supabase-rate-limit/mod.ts";
import type { EdgeLogger } from "../_shared/modules/logger/mod.ts";

type RpcResult = {
  data: unknown;
  error: { message: string } | null;
};

function rpcClient(
  implementation: (name: string, args: Record<string, unknown>) => RpcResult,
): Pick<SupabaseClient, "rpc"> {
  return {
    rpc: (name: string, args?: Record<string, unknown>) =>
      Promise.resolve(implementation(name, args ?? {})),
  } as unknown as Pick<SupabaseClient, "rpc">;
}

function logger(): EdgeLogger {
  return {
    requestId: "rate-limit-test",
    info() {},
    warn() {},
    error() {},
  };
}

Deno.test("rate limit hashes raw client keys before the RPC", async () => {
  let capturedArgs: Record<string, unknown> = {};
  const rawKey = "event:event-id:ip:198.51.100.10";
  const supabase = rpcClient((name, args) => {
    assertEquals(name, "consume_rate_limit");
    capturedArgs = args;
    return {
      data: [{ allowed: true, request_count: 1, retry_after_seconds: 0 }],
      error: null,
    };
  });

  const result = await consumeRequestRateLimit({
    req: new Request("https://edge.test/register"),
    supabase,
    logger: logger(),
    key: rawKey,
    scope: "register-tickets:10m",
    limit: 50,
    windowSeconds: 600,
    salt: "test-only-salt",
  });

  assertEquals(result.allowed, true);
  if (!result.allowed) throw new Error("Expected an allowed rate limit");
  assertEquals(result.keyHash.length, 64);
  assert(!String(capturedArgs.p_key_hash).includes("198.51.100.10"));
  assertEquals(capturedArgs.p_key_hash, result.keyHash);
  assertEquals(capturedArgs.p_scope, "register-tickets:10m");
});

Deno.test("rate limit returns a private 429 response with retry-after", async () => {
  const result = await consumeRequestRateLimit({
    req: new Request("https://edge.test/register", {
      headers: { origin: "http://localhost:5173" },
    }),
    supabase: rpcClient(() => ({
      data: [{ allowed: false, request_count: 51, retry_after_seconds: 321 }],
      error: null,
    })),
    logger: logger(),
    key: "event:event-id:ip:unresolved",
    scope: "register-tickets:10m",
    limit: 50,
    windowSeconds: 600,
    salt: "test-only-salt",
  });

  assertEquals(result.allowed, false);
  if (result.allowed) throw new Error("Expected a rejected rate limit");
  assertEquals(result.response.status, 429);
  assertEquals(result.response.headers.get("retry-after"), "321");
  assertEquals(result.response.headers.get("cache-control"), "no-store");
  assertEquals(await result.response.json(), { error: "TOO_MANY_REQUESTS" });
});

Deno.test("rate limit exposes storage failures instead of bypassing them", async () => {
  await assertRejects(
    () =>
      consumeRateLimit({
        supabase: rpcClient(() => ({
          data: null,
          error: { message: "database unavailable" },
        })),
        keyHash: "hash",
        scope: "register-tickets:10m",
        limit: 50,
        windowSeconds: 600,
      }),
    Error,
    "Unable to consume rate limit",
  );
});

Deno.test("rate limit hashes are stable per salt and isolated across salts", async () => {
  const first = await hashRateLimitKey("client", "salt-a");
  const repeated = await hashRateLimitKey("client", "salt-a");
  const isolated = await hashRateLimitKey("client", "salt-b");

  assertEquals(first, repeated);
  assert(first !== isolated);
});
