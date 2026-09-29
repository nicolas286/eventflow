import { runInBackground } from "../_shared/app/background.ts";

Deno.test("internal work is registered with the Edge Runtime before returning", async () => {
  const runtimeGlobal = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(task: Promise<unknown>): void };
  };
  const previous = runtimeGlobal.EdgeRuntime;
  const registered: Promise<unknown>[] = [];
  let finish: (() => void) | undefined;
  const task = new Promise<void>((resolve) => {
    finish = resolve;
  });
  runtimeGlobal.EdgeRuntime = {
    waitUntil: (value) => {
      registered.push(value);
    },
  };
  try {
    await runInBackground(task);
    if (registered[0] !== task) {
      throw new Error("Internal invoice work was not registered");
    }
  } finally {
    finish?.();
    runtimeGlobal.EdgeRuntime = previous;
  }
});

Deno.test("local runtime waits until internal work has finished", async () => {
  const runtimeGlobal = globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(task: Promise<unknown>): void };
  };
  const previous = runtimeGlobal.EdgeRuntime;
  delete runtimeGlobal.EdgeRuntime;
  let finished = false;
  try {
    await runInBackground(
      Promise.resolve().then(() => {
        finished = true;
      }),
    );
    if (!finished) throw new Error("Internal work was dropped");
  } finally {
    runtimeGlobal.EdgeRuntime = previous;
  }
});
