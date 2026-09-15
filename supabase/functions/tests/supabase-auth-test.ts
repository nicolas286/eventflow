import { assertEquals, assertThrows } from "@std/assert";
import {
  parseBearerToken,
  RequestAuthenticationError,
} from "../_shared/modules/supabase-auth/mod.ts";

Deno.test("Bearer parser accepts one opaque token", () => {
  assertEquals(parseBearerToken("Bearer opaque-token"), "opaque-token");
  assertEquals(parseBearerToken("bearer\topaque-token"), "opaque-token");
});

Deno.test("Bearer parser rejects malformed or multi-token headers", () => {
  for (const value of ["", "Basic value", "Bearer", "Bearer one two"]) {
    assertThrows(
      () => parseBearerToken(value),
      RequestAuthenticationError,
    );
  }
});
