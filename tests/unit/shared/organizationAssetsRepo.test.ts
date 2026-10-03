import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadOrgAssetsRepo } from "../../../src/shared/gateways/supabase/repositories/dashboard/uploadOrgAssets.repo";
import { MAX_ASSET_BYTES } from "../../../shared/schemas/organization-assets";
import { EdgeRequestError } from "../../../src/shared/errors/edgeRequestError";

const orgId = "11111111-1111-4111-8111-111111111111";
const otherOrgId = "22222222-2222-4222-8222-222222222222";
const eventId = "33333333-3333-4333-8333-333333333333";
const assetId = "44444444-4444-4444-8444-444444444444";
function image(name = "photo.png", type = "image/png") {
  const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="), (character) => character.charCodeAt(0));
  return new File([bytes], name, { type });
}
function result(kind: "logo" | "default_banner" | "event_banner" = "logo", organization = orgId, event = eventId) {
  const prefix = kind === "event_banner"
    ? `orgs/${organization}/events/${event}/banner`
    : `orgs/${organization}/${kind}`;
  const path = `${prefix}/${assetId}.png`;
  const publicUrl = `https://fixture.example.invalid/storage/v1/object/public/public-assets/${path}`;
  return { path, publicUrl, publicUrlWithBust: `${publicUrl}?v=1234` };
}
function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}
function fixture() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const supabase = createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  const storage = supabase.storage;
  vi.spyOn(supabase, "storage", "get").mockReturnValue(storage);
  return {
    fetch, repo: uploadOrgAssetsRepo(supabase),
    storageFrom: vi.spyOn(storage, "from"),
    rpc: vi.spyOn(supabase, "rpc"), from: vi.spyOn(supabase, "from"),
  };
}

describe("organization assets through the binary Edge API", () => {
  let client: ReturnType<typeof fixture>;
  beforeEach(() => { client = fixture(); });
  afterEach(() => {
    expect(client.storageFrom).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("sends the raw File with MIME and scope query, then returns server-owned URLs", async () => {
    const file = image();
    client.fetch.mockResolvedValueOnce(json(result()));
    expect(await client.repo.uploadOrgLogo({ orgId, file })).toEqual(result());
    const [url, options] = client.fetch.mock.calls[0];
    const requestUrl = new URL(String(url));
    expect(requestUrl.pathname).toBe("/functions/v1/organizations/assets/upload");
    expect(Object.fromEntries(requestUrl.searchParams)).toEqual({ orgId, kind: "logo" });
    expect(options?.method).toBe("POST");
    expect(options?.body).toBe(file);
    expect(new Headers(options?.headers).get("Content-Type")).toBe("image/png");
  });

  it("keeps default-banner and event-banner signatures with their scoped query", async () => {
    const file = image();
    client.fetch.mockResolvedValueOnce(json(result("default_banner")));
    expect(await client.repo.uploadOrgDefaultBanner({ orgId, file })).toEqual(result("default_banner"));
    client.fetch.mockResolvedValueOnce(json(result("event_banner")));
    expect(await client.repo.uploadEventBanner({ orgId, eventId, file })).toEqual(result("event_banner"));
    expect(Object.fromEntries(new URL(String(client.fetch.mock.calls[0][0])).searchParams)).toEqual({ orgId, kind: "default_banner" });
    expect(Object.fromEntries(new URL(String(client.fetch.mock.calls[1][0])).searchParams)).toEqual({ orgId, eventId, kind: "event_banner" });
  });

  it("does not derive paths or extensions from a supplied file name", async () => {
    client.fetch.mockResolvedValueOnce(json(result()));
    const file = image("../../victim/logo.svg");
    expect((await client.repo.uploadOrgLogo({ orgId, file })).path).toBe(result().path);
    const query = new URL(String(client.fetch.mock.calls[0][0])).searchParams;
    expect([...query.keys()]).toEqual(["orgId", "kind"]);
    expect(client.fetch.mock.calls[0][1]?.body).toBe(file);
  });

  it.each(["image/svg+xml", "application/octet-stream", "text/html", ""])(
    "rejects MIME %s before making a request", async (type) => {
      await expect(client.repo.uploadOrgLogo({ orgId, file: image("image.svg", type) })).rejects.toThrow("PNG, JPEG, WebP ou GIF");
      expect(client.fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects empty files and files beyond 5 MiB", async () => {
    await expect(client.repo.uploadOrgLogo({ orgId, file: new File([], "empty.png", { type: "image/png" }) })).rejects.toThrow("vide");
    const large = new File([new Uint8Array(MAX_ASSET_BYTES + 1)], "large.png", { type: "image/png" });
    await expect(client.repo.uploadOrgLogo({ orgId, file: large })).rejects.toThrow("5 Mo");
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it.each([{ path: "orgs/victim/logo.png" }, { upsert: true }, { ext: "svg" }, { bucket: "private-assets" }, { kind: "default_banner" }])(
    "rejects forged upload options %j", async (forged) => {
      const params = { orgId, file: image(), ...forged };
      await expect(client.repo.uploadOrgLogo(params)).rejects.toThrow();
      expect(client.fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid organization IDs and missing event IDs", async () => {
    await expect(client.repo.uploadOrgLogo({ orgId: "invalid", file: image() })).rejects.toThrow();
    await expect(client.repo.uploadEventBanner({ orgId, eventId: "", file: image() })).rejects.toThrow();
    expect(client.fetch).not.toHaveBeenCalled();
  });

  it("rejects a path belonging to another organization or event", async () => {
    client.fetch.mockResolvedValueOnce(json(result("logo", otherOrgId)));
    await expect(client.repo.uploadOrgLogo({ orgId, file: image() })).rejects.toThrow();
    client.fetch.mockResolvedValueOnce(json(result("event_banner", orgId, otherOrgId)));
    await expect(client.repo.uploadEventBanner({ orgId, eventId, file: image() })).rejects.toThrow();
  });

  it("rejects mismatched public and preview URL locations", async () => {
    client.fetch.mockResolvedValueOnce(json({ ...result(), publicUrl: "https://fixture.example.invalid/unrelated.png" }));
    await expect(client.repo.uploadOrgLogo({ orgId, file: image() })).rejects.toThrow();
    client.fetch.mockResolvedValueOnce(json({ ...result(), publicUrlWithBust: `https://other.example.invalid/storage/v1/object/public/public-assets/${result().path}` }));
    await expect(client.repo.uploadOrgLogo({ orgId, file: image() })).rejects.toThrow();
  });

  it("rejects malformed or empty upload responses", async () => {
    client.fetch.mockResolvedValueOnce(json({ success: true }));
    await expect(client.repo.uploadOrgLogo({ orgId, file: image() })).rejects.toThrow();
    client.fetch.mockResolvedValueOnce(json(null));
    await expect(client.repo.uploadOrgLogo({ orgId, file: image() })).rejects.toThrow("EDGE_EMPTY_RESPONSE");
  });

  it.each([
    [429, "TOO_MANY_REQUESTS", 12], [503, "RATE_LIMIT_UNAVAILABLE", 30],
  ])("preserves upload quota error %s and Retry-After", async (status, code, delay) => {
    client.fetch.mockResolvedValueOnce(json({ error: code }, status, { "Retry-After": String(delay) }));
    const promise = client.repo.uploadOrgLogo({ orgId, file: image() });
    await expect(promise).rejects.toBeInstanceOf(EdgeRequestError);
    await expect(promise).rejects.toMatchObject({ message: code, status, retryAfterSeconds: delay });
  });

  it("preserves server byte-validation and authorization refusals", async () => {
    client.fetch.mockResolvedValueOnce(json({ error: "ASSET_INVALID_IMAGE" }, 400));
    await expect(client.repo.uploadOrgLogo({ orgId, file: image() })).rejects.toThrow("ASSET_INVALID_IMAGE");
    client.fetch.mockResolvedValueOnce(json({ error: "FORBIDDEN" }, 403));
    await expect(client.repo.uploadOrgLogo({ orgId, file: image() })).rejects.toThrow("FORBIDDEN");
  });
});
