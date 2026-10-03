import {
  BodyTooLargeError,
  readLimitedJson,
  readLimitedText,
} from "../_shared/app/request-body.ts";
import { assertEquals, assertRejects } from "@std/assert";

Deno.test("bounded reader cancels at overflow and preserves split UTF-8 verbatim", async () => {
  const text = ' {"text":"é😊", "escape":"\\u00e9", "n":1.00} \n';
  const bytes = new TextEncoder().encode(text);
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
  for (const length of [undefined, "1", String(bytes.length)]) {
    const headers = new Headers();
    if (length !== undefined) headers.set("content-length", length);
    assertEquals(
      await readLimitedText(
        new Request("https://fixture.test", {
          method: "POST",
          headers,
          body: stream(),
        }),
        bytes.length,
      ),
      text,
    );
  }
  let canceled = false;
  let reads = 0;
  const oversized = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads++;
      controller.enqueue(new Uint8Array(9));
    },
    cancel() {
      canceled = true;
    },
  });
  await assertRejects(
    () =>
      readLimitedText(
        new Request("https://fixture.test", {
          method: "POST",
          body: oversized,
        }),
        8,
      ),
    BodyTooLargeError,
  );
  assertEquals(canceled, true);
  assertEquals(reads <= 2, true, "reader must not drain an oversized stream");
});

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
