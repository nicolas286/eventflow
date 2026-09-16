import { assertEquals } from "@std/assert";
import { postInternalEdgeJson } from "../_shared/app/internal-edge/mod.ts";

Deno.test("internal Edge client sends canonical and transitional authentication", async () => {
  let capturedAuthorization: string | null = null;
  let capturedLegacyToken: string | null = null;
  let capturedBody: unknown = null;

  const result = await postInternalEdgeJson<{ ok: boolean }>({
    functionsBase: "https://project.example.supabase.co/functions/v1",
    path: "/send-confirmation-mail",
    serviceToken: "service-secret",
    body: { templateId: "order_confirmation_v1" },
    fetch: async (input, init) => {
      const request = new Request(input, init);
      capturedAuthorization = request.headers.get("authorization");
      capturedLegacyToken = request.headers.get("x-service-token");
      capturedBody = await request.json();
      return Response.json({ ok: true });
    },
  });

  assertEquals(result.ok, true);
  assertEquals(result.data, { ok: true });
  assertEquals(capturedAuthorization, "Bearer service-secret");
  assertEquals(capturedLegacyToken, "service-secret");
  assertEquals(capturedBody, {
    templateId: "order_confirmation_v1",
  });
});

Deno.test("internal Edge client bounds a non-JSON response", async () => {
  const result = await postInternalEdgeJson<{ raw: string }>({
    functionsBase: "https://project.example.supabase.co/functions/v1",
    path: "/send-confirmation-mail",
    serviceToken: "service-secret",
    body: {},
    fetch: async () => new Response("x".repeat(400), { status: 502 }),
  });

  assertEquals(result.ok, false);
  assertEquals(result.status, 502);
  assertEquals(result.data?.raw.length, 300);
});
