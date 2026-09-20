/** Keep internal work alive after the HTTP response in Supabase Edge Runtime. */
export async function runInBackground(task: Promise<unknown>): Promise<void> {
  const runtime = (globalThis as typeof globalThis & {
    EdgeRuntime?: { waitUntil(promise: Promise<unknown>): void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(task);
    return;
  }
  // Local Deno and unit tests have no EdgeRuntime lifecycle hook.
  await task;
}
