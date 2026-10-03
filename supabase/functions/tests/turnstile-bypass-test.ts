import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { assertTurnstileBypassAllowed } from "../_shared/environment-safety.ts";
import { ResponseError } from "../_shared/errors.ts";
import { resolveRuntimeConfig } from "../orders/public/config.ts";
import { verifyCaptchaOrThrow } from "../orders/public/turnstile.ts";

async function fixture(
  environment: string | undefined,
  url: string,
  run: () => Promise<void>,
) {
  const values: Record<string, string | undefined> = {
    APP_ENV: environment,
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: "fixture-anon",
    SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
    APP_BASE_URL: "https://app.fixture.test",
    FUNCTIONS_URL: `${url}/functions/v1`,
    TURNSTILE_BYPASS: "1",
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    REGISTER_RATE_LIMIT_PER_10MIN: "50",
    DEBUG_ERRORS: "0",
    EVENT_PAYMENT_PROVIDER: "stripe",
  };
  const previous = new Map(
    Object.keys(values).map((key) => [key, Deno.env.get(key)]),
  );
  const fetcher = globalThis.fetch;
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  try {
    await run();
  } finally {
    globalThis.fetch = fetcher;
    for (const [key, value] of previous) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
}

const production = "https://dixirvllhfkvqoahhfqh.supabase.co";
for (
  const [environment, url] of [
    ["production", production],
    [undefined, production],
    ["staging", production],
    ["staging", production + ":443"],
    ["staging", production + "/"],
    ["staging", "https://DIXIRVLLHFKVQOAHHFQH.supabase.co"],
    ["local", production],
    ["production", "http://localhost:54321"],
    [undefined, "https://unknown.supabase.co"],
    ["unknown", "http://localhost:54321"],
    ["staging", ""],
    ["staging", "not-a-url"],
    ["staging", "https://unknown.example"],
  ] as const
) {
  Deno.test(`CAPTCHA bypass refuses production/ambiguous configuration ${environment} ${url}`, () =>
    fixture(environment, url, async () => {
      let calls = 0;
      globalThis.fetch = () => {
        calls++;
        throw new Error("Unexpected provider request");
      };
      const error = assertThrows(
        assertTurnstileBypassAllowed,
        ResponseError,
        "TURNSTILE_BYPASS_FORBIDDEN",
      );
      assertEquals(error.status, 500);
      await assertRejects(
        () =>
          verifyCaptchaOrThrow({
            turnstileSecret: "official-test-fixture",
            turnstileBypass: true,
            token: "TEST_BYPASS",
            ip: null,
          }),
        ResponseError,
        "TURNSTILE_BYPASS_FORBIDDEN",
      );
      // Forbidden bypass is rejected even when a regular CAPTCHA token is supplied.
      await assertRejects(
        () =>
          verifyCaptchaOrThrow({
            turnstileSecret: "official-test-fixture",
            turnstileBypass: true,
            token: "regular",
            ip: null,
          }),
        ResponseError,
        "TURNSTILE_BYPASS_FORBIDDEN",
      );
      assertEquals(calls, 0);
      if (url) {
        assertThrows(
          () => resolveRuntimeConfig(new Request("https://app.fixture.test")),
          ResponseError,
          "TURNSTILE_BYPASS_FORBIDDEN",
        );
      }
    }));
}

for (
  const [environment, url] of [
    ["staging", "https://cpcmcxerrsnnjncrhldr.supabase.co"],
    ["staging", "https://synthetic.supabase.co"],
    [undefined, "http://localhost:54321"],
    ["local", "http://127.0.0.1:54321"],
    ["development", "http://kong:8000"],
    ["local", "http://[::1]:54321"],
  ] as const
) {
  Deno.test(`CAPTCHA bypass preserves explicit staging/local fixture ${environment} ${url}`, () =>
    fixture(environment, url, async () => {
      globalThis.fetch = () => {
        throw new Error("Bypass must not call Turnstile");
      };
      assertEquals(
        resolveRuntimeConfig(new Request("https://app.fixture.test"))
          .turnstileBypass,
        true,
      );
      await verifyCaptchaOrThrow({
        turnstileSecret: null,
        turnstileBypass: true,
        token: "TEST_BYPASS",
        ip: null,
      });
    }));
}

Deno.test("CAPTCHA test keys use verification; TEST_BYPASS without permission is not accepted", () =>
  fixture("staging", "https://synthetic.supabase.co", async () => {
    let calls = 0;
    globalThis.fetch = (input, init) => {
      calls++;
      assertEquals(
        String(input),
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
      const form = new URLSearchParams(String(init?.body));
      return Promise.resolve(
        Response.json({
          success: form.get("response") === "official-test-token",
        }),
      );
    };
    Deno.env.set("TURNSTILE_BYPASS", "0");
    assertEquals(
      resolveRuntimeConfig(new Request("https://app.fixture.test"))
        .turnstileBypass,
      false,
    );
    await verifyCaptchaOrThrow({
      turnstileSecret: "official-test-fixture",
      turnstileBypass: false,
      token: "official-test-token",
      ip: null,
    });
    await assertRejects(
      () =>
        verifyCaptchaOrThrow({
          turnstileSecret: "official-test-fixture",
          turnstileBypass: false,
          token: "TEST_BYPASS",
          ip: null,
        }),
      ResponseError,
      "CAPTCHA_FAILED",
    );
    // Enabling bypass does not skip verification for ordinary tokens.
    await verifyCaptchaOrThrow({
      turnstileSecret: "official-test-fixture",
      turnstileBypass: true,
      token: "official-test-token",
      ip: null,
    });
    assertEquals(calls, 3);
  }));
