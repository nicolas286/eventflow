import type { Session } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbPromoCode } from "../../../shared/schemas/promo-codes";

const fixture = vi.hoisted((): {
  session: Session | null; orgId: string; eventId: string;
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>; showToast: ReturnType<typeof vi.fn>; changed: ReturnType<typeof vi.fn>;
  memoCursor: number; memos: { dependencies: readonly unknown[]; value: unknown }[];
  stateCursor: number; states: unknown[]; refCursor: number; refs: { current: unknown }[];
  subscriptionCursor: number; subscriptions: { subscribe: unknown; cleanup: () => void }[];
  effectCursor: number; effects: { dependencies: readonly unknown[]; cleanup?: void | (() => void) }[];
  effectQueue: (() => void)[];
} => ({
  session: null, orgId: "", eventId: "", fetch: vi.fn<typeof globalThis.fetch>(), showToast: vi.fn(), changed: vi.fn(),
  memoCursor: 0, memos: [], stateCursor: 0, states: [], refCursor: 0, refs: [], subscriptionCursor: 0, subscriptions: [],
  effectCursor: 0, effects: [], effectQueue: [],
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (callback: () => unknown, dependencies: readonly unknown[]) => {
    const index = fixture.memoCursor++;
    const previous = fixture.memos[index];
    if (!previous || dependencies.length !== previous.dependencies.length || dependencies.some((dependency, i) => !Object.is(dependency, previous.dependencies[i]))) {
      fixture.memos[index] = { dependencies, value: callback() };
    }
    return fixture.memos[index].value;
  },
  useState: (initial: unknown) => {
    const index = fixture.stateCursor++;
    if (!Object.prototype.hasOwnProperty.call(fixture.states, index)) fixture.states[index] = initial;
    return [fixture.states[index], (next: unknown) => {
      fixture.states[index] = typeof next === "function" ? next(fixture.states[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.refCursor++;
    fixture.refs[index] ??= { current: initial };
    return fixture.refs[index];
  },
  useEffect: (callback: () => void | (() => void), dependencies: readonly unknown[]) => {
    const index = fixture.effectCursor++;
    const previous = fixture.effects[index];
    if (!previous || dependencies.some((dependency, i) => !Object.is(dependency, previous.dependencies[i]))) {
      const effect = { dependencies, cleanup: previous?.cleanup };
      fixture.effects[index] = effect;
      fixture.effectQueue.push(() => { effect.cleanup?.(); effect.cleanup = callback(); });
    }
  },
  useSyncExternalStore: (subscribe: (callback: () => void) => () => void, snapshot: () => unknown) => {
    const index = fixture.subscriptionCursor++;
    const previous = fixture.subscriptions[index];
    if (!previous || previous.subscribe !== subscribe) {
      previous?.cleanup();
      fixture.subscriptions[index] = { subscribe, cleanup: subscribe(() => undefined) };
    }
    return snapshot();
  },
}));
vi.mock("@providers/AuthProvider/useAuth", () => ({ useAuth: () => ({ session: fixture.session }) }));
vi.mock("@ui/components/button/Button", () => ({ default: "button" }));
vi.mock("@shared/ui/components/toast/useToast", () => ({ useToast: () => ({ showToast: fixture.showToast }) }));
import { EventPromoCodesPanel } from "../../../src/app/modules/admin/promoCodes/components/EventPromoCodesPanel";

const orgA = "11111111-1111-4111-8111-111111111111";
const eventA = "22222222-2222-4222-8222-222222222222";
const id = "33333333-3333-4333-8333-333333333333";
const row: DbPromoCode = {
  orgId: orgA, eventId: eventA, id, code: "WELCOME", discountPercent: 10, discountCents: null,
  maxUses: null, usedCount: 0, isActive: true, startsAt: null, endsAt: null,
  createdAt: "2026-10-03 08:00:00+02", updatedAt: "2026-10-03 08:00:00+02",
};
const client = createClient("https://fixture.example.invalid", "fixture-public-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (url, options) => {
    const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    const paths = ["list", "create", "read", "update", "delete"].map((action) => `/functions/v1/events/promos/${action}`);
    if (!paths.includes(new URL(target).pathname)) throw new Error("Unexpected promo API route");
    return fixture.fetch(url, options);
  } },
});
function session(id = "A", revision = 1): Session {
  return {
    access_token: `${btoa('{}')}.${btoa(JSON.stringify({ session_id: `session-${id}`, revision }))}.fixture`,
    refresh_token: `fixture-refresh-${id}-${revision}`, token_type: "bearer", expires_in: 3600,
    user: { id, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-03" },
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
type ActionProps = {
  onClick?: () => void | Promise<void>; onChange?: (event: { target: { value: string } }) => void;
  value?: unknown; children?: unknown; placeholder?: string; disabled?: boolean;
};
function nodes(value: unknown): ReactElement<ActionProps>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<ActionProps>(value)) return [];
  return [value, ...Object.values(value.props).flatMap(nodes)];
}
function PanelProbe() {
  return EventPromoCodesPanel({ supabase: client, orgId: fixture.orgId, onChanged: fixture.changed,
    event: { id: fixture.eventId, slug: "event-fixture", title: "Event fixture", isPublished: false,
      updatedAt: "2026-10-03", bannerUrlRaw: null, bannerUrlEffective: "https://example.invalid/banner.png" },
  });
}
function render() {
  fixture.memoCursor = 0; fixture.stateCursor = 0; fixture.refCursor = 0; fixture.subscriptionCursor = 0; fixture.effectCursor = 0;
  const tree = PanelProbe(); fixture.effectQueue.splice(0).forEach((effect) => effect()); return tree;
}
function action(label: string) {
  const callback = nodes(render()).find((node) => node.props.children === label)?.props.onClick;
  if (!callback) throw new Error(`Missing real promo action ${label}`);
  return callback;
}
function editCode(code: string) {
  const input = nodes(render()).find((node) => node.props.placeholder === "CLUB10");
  if (!input?.props.onChange) throw new Error("Missing real promo code draft input");
  input.props.onChange({ target: { value: code } });
}
function draftCode() { return nodes(render()).find((node) => node.props.placeholder === "CLUB10")?.props.value; }
async function loaded(rows: DbPromoCode[] = []) {
  fixture.fetch.mockResolvedValueOnce(Response.json(rows)); render();
  await vi.waitFor(() => {
    expect(fixture.fetch).toHaveBeenCalledOnce();
    expect(nodes(render()).some((node) => node.props.children === "Chargement…")).toBe(false);
  });
}
function replaceScope(change: string) {
  if (change === "session") fixture.session = session("B");
  if (change === "organization") fixture.orgId = id;
  if (change === "event") fixture.eventId = id;
  if (change === "unmount") {
    fixture.subscriptions.forEach(({ cleanup }) => cleanup()); fixture.subscriptions = []; return;
  }
  fixture.fetch.mockResolvedValueOnce(Response.json([])); render();
}
beforeEach(() => {
  fixture.session = session(); fixture.orgId = orgA; fixture.eventId = eventA;
  fixture.memoCursor = 0; fixture.memos = []; fixture.stateCursor = 0; fixture.states = [];
  fixture.refCursor = 0; fixture.refs = []; fixture.subscriptionCursor = 0; fixture.subscriptions = [];
  fixture.effectCursor = 0; fixture.effects = []; fixture.effectQueue = [];
  fixture.fetch.mockReset(); fixture.showToast.mockClear(); fixture.changed.mockReset(); fixture.changed.mockResolvedValue(undefined);
});
afterEach(() => { fixture.subscriptions.forEach(({ cleanup }) => cleanup()); });

describe("promo panel mutation continuations with real hooks and Edge repositories", () => {
  it("loads once, preserves a current creation across JWT refresh and reloads after success", async () => {
    await loaded(); editCode(" submitted "); const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    const pending = action("Créer le code")(); await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledTimes(2));
    fixture.session = session("A", 2); render(); response.resolve(Response.json({ ...row, code: "SUBMITTED" })); await pending;
    expect(draftCode()).toBe(""); expect(fixture.changed).toHaveBeenCalledOnce();
    expect(fixture.showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    const [url, options] = fixture.fetch.mock.calls[1];
    expect(String(url)).toContain("/events/promos/create");
    expect(JSON.parse(String(options?.body))).toMatchObject({ orgId: orgA, eventId: eventA, code: "SUBMITTED", discountPercent: 10, discountCents: null });
    render(); expect(fixture.fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["session", "organization", "event", "unmount"])("ignores a late create response after %s replacement", async (change) => {
    await loaded(); editCode("SUBMITTED"); const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    const pending = action("Créer le code")(); await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledTimes(2));
    replaceScope(change); response.resolve(Response.json(row)); await pending;
    expect(fixture.showToast).not.toHaveBeenCalled(); expect(fixture.changed).not.toHaveBeenCalled();
  });

  it.each([true, false])("preserves a newer draft and suppresses the older creation result (success: %s)", async (success) => {
    await loaded(); editCode("SUBMITTED"); const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    const pending = action("Créer le code")(); await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledTimes(2));
    editCode("UNSAVED_NEXT"); response.resolve(success ? Response.json(row) : Response.json({ error: "CONFLICT" }, { status: 409 })); await pending;
    expect(draftCode()).toBe("UNSAVED_NEXT"); expect(fixture.showToast).not.toHaveBeenCalled(); expect(fixture.changed).not.toHaveBeenCalled();
  });

  it("keeps a current failed draft and shows one business error", async () => {
    await loaded(); editCode("SUBMITTED"); fixture.fetch.mockResolvedValueOnce(Response.json({ error: "CONFLICT" }, { status: 409 }));
    await action("Créer le code")(); expect(draftCode()).toBe("SUBMITTED");
    expect(fixture.showToast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ variant: "error" }));
    expect(fixture.changed).not.toHaveBeenCalled();
  });

  it.each(["Désactiver", "Supprimer"])("ignores an old %s callback after event replacement", async (label) => {
    await loaded([row]); const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    const pending = action(label)(); await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledTimes(2));
    replaceScope("event"); response.resolve(label === "Supprimer" ? Response.json({ success: true }) : Response.json({ ...row, isActive: false })); await pending;
    expect(fixture.showToast).not.toHaveBeenCalled(); expect(fixture.changed).not.toHaveBeenCalled();
  });

  it("preserves the used-count delete guard while allowing current deactivate/delete callbacks", async () => {
    await loaded([{ ...row, usedCount: 1 }]);
    expect(nodes(render()).some((node) => node.props.children === "Supprimer")).toBe(false);
    fixture.fetch.mockResolvedValueOnce(Response.json({ ...row, usedCount: 1, isActive: false }));
    await action("Désactiver")(); expect(fixture.changed).toHaveBeenCalledOnce();
    expect(fixture.showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("ignores late loading data and errors after the organization changes", async () => {
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise); render();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    replaceScope("organization"); response.resolve(Response.json({ error: "FORBIDDEN" }, { status: 403 }));
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledTimes(2)); render();
    expect(fixture.showToast).not.toHaveBeenCalled(); expect(fixture.changed).not.toHaveBeenCalled();
  });

  it("deletes an unused code in the current scope while preserving the unrelated draft", async () => {
    await loaded([row]); editCode("UNSAVED_NEXT"); fixture.fetch.mockResolvedValueOnce(Response.json({ success: true }));
    await action("Supprimer")();
    expect(draftCode()).toBe("UNSAVED_NEXT"); expect(fixture.changed).toHaveBeenCalledOnce();
    expect(nodes(render()).some((node) => node.props.children === "WELCOME")).toBe(false);
    expect(fixture.showToast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ variant: "success" }));
  });

  it("keeps a new input drafted while the successful create is awaiting the parent refresh", async () => {
    await loaded(); editCode("SUBMITTED"); fixture.fetch.mockResolvedValueOnce(Response.json(row));
    const refresh = deferred<void>(); fixture.changed.mockImplementationOnce(() => refresh.promise);
    const pending = action("Créer le code")();
    await vi.waitFor(() => expect(fixture.changed).toHaveBeenCalledOnce());
    editCode("UNSAVED_DURING_REFRESH"); refresh.resolve(); await pending;
    expect(draftCode()).toBe("UNSAVED_DURING_REFRESH"); expect(fixture.changed).toHaveBeenCalledOnce();
  });

  it("allows input during initial loading and waits for that list before submitting a create", async () => {
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise); render();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    editCode("UNSAVED_NEXT");
    expect(nodes(render()).find((node) => node.props.children === "Créer le code")?.props.disabled).toBe(true);
    await action("Créer le code")(); expect(fixture.fetch).toHaveBeenCalledOnce();
    expect(draftCode()).toBe("UNSAVED_NEXT");
    response.resolve(Response.json([row]));
    await vi.waitFor(() => expect(nodes(render()).some((node) => node.props.children === "WELCOME")).toBe(true));
    expect(nodes(render()).find((node) => node.props.children === "Créer le code")?.props.disabled).toBe(false);
    expect(draftCode()).toBe("UNSAVED_NEXT");
  });
});
