import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

// Execute each actual refresh helper in isolation: webhook modules otherwise
// start Deno.serve and import remote modules at module evaluation time.
const paths = [
  "supabase/functions/orders/public/mollie-auth.ts",
  "supabase/functions/mollie-webhook-tickets/index.ts",
  "supabase/functions/mollie-webhook/index.ts",
];

function loadRefresh(path: string, redirectUri: string | undefined) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const helper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "refreshMollieAccessToken");
  if (!helper) throw new Error(`Missing refresh helper in ${path}`);
  const values: Record<string, string | undefined> = {
    MOLLIE_CONNECT_CLIENT_ID: "app_test",
    MOLLIE_CONNECT_CLIENT_SECRET: "fake-client-secret",
    MOLLIE_CONNECT_REDIRECT_URI: redirectUri,
  };
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }), { status: 200 }));
  const error = (code: string) => new Error(code);
  const context = {
    Deno: { env: { get: (key: string) => values[key] } },
    envTrim: (key: string) => values[key]?.trim() || null,
    fetch, URLSearchParams, Date, internal: error, badGateway: error,
  };
  const code = ts.transpileModule(helper.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const refresh = runInNewContext(`${code}\nrefreshMollieAccessToken`, context);
  return { refresh, fetch };
}

describe.each(paths)("Mollie refresh request: %s", path => {
  it("sends the configured OAuth callback unchanged, including query encoding", async () => {
    const callback = "https://project.supabase.co/functions/v1/mollie-connect-callback?source=a&target=b";
    const { refresh, fetch } = loadRefresh(path, `  ${callback}  `);
    const result = await refresh("old-refresh+token");
    expect(result.accessToken).toBe("new-access");
    expect(result.refreshToken).toBe("new-refresh");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe("https://api.mollie.com/oauth2/tokens");
    expect(options.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(options.body))).toEqual({
      grant_type: "refresh_token", refresh_token: "old-refresh+token",
      client_id: "app_test", client_secret: "fake-client-secret", redirect_uri: callback,
    });
  });

  it.each([undefined, "   "])("does not contact Mollie without a callback (%s)", async callback => {
    const { refresh, fetch } = loadRefresh(path, callback);
    if (path.includes("orders/public/")) await expect(refresh("old-refresh")).rejects.toThrow("CONNECT_CLIENT_MISSING");
    else expect(await refresh("old-refresh")).toEqual({ ok: false, error: "connect_client_missing" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
