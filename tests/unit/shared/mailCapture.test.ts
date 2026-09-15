import { afterEach, expect, it, vi } from "vitest";
import { captureMail } from "../../../supabase/functions/_shared/mail/capture";
afterEach(() => vi.unstubAllGlobals());
function config(url: string, mode = "capture") {
  const values: Record<string, string> = { SUPABASE_URL: url, MAIL_MODE: mode, SUPABASE_SERVICE_ROLE_KEY: "test-server-key" };
  vi.stubGlobal("Deno", { env: { get: (name: string) => values[name] } });
}
it("captures in this project's private bucket without calling an email provider", async () => {
  config("https://staging.supabase.co");
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await captureMail({ to: "synthetic@example.com", html: "Test" });
  expect(result.provider).toBe("capture");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toMatch(/^https:\/\/staging\.supabase\.co\/storage\/v1\/object\/mail-previews\//);
});
it("does not capture messages into the production project", async () => {
  config("https://dixirvllhfkvqoahhfqh.supabase.co");
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(captureMail({})).rejects.toThrow("MAIL_CAPTURE_DISABLED");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("reports storage failure instead of marking the message delivered", async () => {
  config("https://staging.supabase.co");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 403 })));
  await expect(captureMail({})).rejects.toThrow("MAIL_CAPTURE_FAILED");
});
