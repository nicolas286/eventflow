import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBillitEnabled, assertFunctionsUrl, assertMailRecipients, assertMollieApiKey, assertMollieTestMode } from "../../../supabase/functions/_shared/environment-safety";

function environment(values: Record<string, string>) {
  vi.stubGlobal("Deno", { env: { get: (key: string) => values[key] } });
}
afterEach(() => vi.unstubAllGlobals());
describe("staging external effects", () => {
  it("fails closed on a new project even without APP_ENV", () => {
    environment({ SUPABASE_URL: "https://staging.supabase.co" });
    expect(() => assertMollieTestMode("live")).toThrow("LIVE_PAYMENTS_DISABLED");
    expect(() => assertMollieApiKey("live_secret")).toThrow();
    expect(() => assertMailRecipients("customer@example.com")).toThrow();
    expect(() => assertBillitEnabled()).toThrow();
  });
  it("permits test payments and only explicitly allowed recipients", () => {
    environment({ APP_ENV: "staging", MAIL_ALLOWED_RECIPIENTS: "qa@example.com" });
    expect(() => assertMollieTestMode("test")).not.toThrow();
    expect(() => assertMollieApiKey("test_secret")).not.toThrow();
    expect(() => assertMailRecipients("QA@example.com")).not.toThrow();
    expect(() => assertMailRecipients(["qa@example.com", "customer@example.com"])).toThrow();
  });
  it("rejects a production label on the staging project", () => {
    environment({ APP_ENV: "production", SUPABASE_URL: "https://staging.supabase.co" });
    expect(() => assertMollieApiKey("live_secret")).toThrow("ENVIRONMENT_PROJECT_MISMATCH");
  });
  it("preserves the existing production external effects", () => {
    environment({ SUPABASE_URL: "https://dixirvllhfkvqoahhfqh.supabase.co" });
    expect(() => assertMollieTestMode("live")).not.toThrow();
    expect(() => assertMollieApiKey("live_secret")).not.toThrow();
    expect(() => assertMailRecipients("customer@example.com")).not.toThrow();
    expect(() => assertBillitEnabled()).not.toThrow();
  });
  it("rejects cross-project internal calls", () => {
    environment({ APP_ENV: "staging" });
    expect(() => assertFunctionsUrl("https://production.supabase.co/functions/v1", "https://staging.supabase.co")).toThrow();
    expect(() => assertFunctionsUrl("https://staging.supabase.co/functions/v1", "https://staging.supabase.co")).not.toThrow();
  });
});
