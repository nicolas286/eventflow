import { assertEquals, assertFalse } from "@std/assert";
import {
  createCors,
  createJsonResponse,
  createRequestGuard,
} from "../_shared/modules/http/mod.ts";

const logger = {
  info: () => undefined,
  warn: () => undefined,
};

Deno.test("CORS reflects an allowed origin and rejects an unknown origin", () => {
  const cors = createCors({
    allowedOrigins: new Set(["https://app.example.test"]),
  });

  const allowed = cors.getHeaders(
    new Request("https://edge.test", {
      headers: { origin: "https://app.example.test" },
    }),
  );
  const rejected = cors.getHeaders(
    new Request("https://edge.test", {
      headers: { origin: "https://evil.example" },
    }),
  );

  assertEquals(
    allowed["Access-Control-Allow-Origin"],
    "https://app.example.test",
  );
  assertFalse("Access-Control-Allow-Origin" in rejected);
  assertEquals(allowed.Vary, "Origin");
});

Deno.test("JSON responses are private and include request CORS headers", async () => {
  const cors = createCors({
    allowedOrigins: new Set(["https://app.example.test"]),
  });
  const json = createJsonResponse(cors.getHeaders);
  const request = new Request("https://edge.test", {
    headers: { origin: "https://app.example.test" },
  });
  const response = json(request, { ok: true }, 201);

  assertEquals(response.status, 201);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(
    response.headers.get("access-control-allow-origin"),
    request.headers.get("origin"),
  );
  assertEquals(await response.json(), { ok: true });
});

Deno.test("request guard handles preflight and rejected methods", async () => {
  const cors = createCors({
    allowedOrigins: new Set(["https://app.example.test"]),
  });
  const json = createJsonResponse(cors.getHeaders);
  const guard = createRequestGuard({ getCorsHeaders: cors.getHeaders, json });

  const preflight = guard(
    new Request("https://edge.test", { method: "OPTIONS" }),
    logger,
    "POST",
  );
  const rejected = guard(
    new Request("https://edge.test", { method: "GET" }),
    logger,
    "POST",
  );

  assertEquals(preflight?.status, 204);
  assertEquals(rejected?.status, 405);
  assertEquals(await rejected?.json(), {
    error: "METHOD_NOT_ALLOWED",
    allowedMethods: ["POST"],
  });
});
