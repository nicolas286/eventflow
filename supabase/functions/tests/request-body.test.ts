import {
  BodyTooLargeError,
  readLimitedJson,
} from "../_shared/app/request-body.ts";

Deno.test("JSON reader rejects an oversized streamed payload without Content-Length", async () => {
  const request = new Request("https://fixture.test", {
    method: "POST",
    body: '"éééé"',
  });
  try {
    await readLimitedJson(request, 8);
    throw new Error("Expected limit error");
  } catch (error) {
    if (!(error instanceof BodyTooLargeError)) throw error;
  }
});

Deno.test("JSON reader preserves malformed JSON errors and accepts valid bodies", async () => {
  const valid = await readLimitedJson(
    new Request("https://fixture.test", {
      method: "POST",
      body: '{"ok":true}',
    }),
  );
  if (JSON.stringify(valid) !== '{"ok":true}') {
    throw new Error("Payload changed");
  }
  try {
    await readLimitedJson(
      new Request("https://fixture.test", { method: "POST", body: "{" }),
    );
    throw new Error("Expected syntax error");
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
});
