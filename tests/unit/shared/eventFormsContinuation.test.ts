import type { Session } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventFormField, EventFormFieldGroup } from "../../../shared/schemas/event-forms";

const fixture = vi.hoisted((): {
  session: Session | null; orgId: string; eventId: string;
  fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>; showToast: ReturnType<typeof vi.fn>;
  changed: ReturnType<typeof vi.fn>; dirty: boolean;
  memoCursor: number; memos: { dependencies: readonly unknown[]; value: unknown }[];
  stateCursor: number; states: unknown[]; refCursor: number; refs: { current: unknown }[];
  subscriptionCursor: number; subscriptions: { subscribe: unknown; cleanup: () => void }[];
} => ({
  session: null, orgId: "", eventId: "", fetch: vi.fn<typeof globalThis.fetch>(), showToast: vi.fn(), changed: vi.fn(), dirty: false,
  memoCursor: 0, memos: [], stateCursor: 0, states: [], refCursor: 0, refs: [], subscriptionCursor: 0, subscriptions: [],
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
      fixture.dirty = true;
    }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.refCursor++;
    fixture.refs[index] ??= { current: initial };
    return fixture.refs[index];
  },
  useEffect: () => undefined,
  useLayoutEffect: (callback: () => void, dependencies: readonly unknown[]) => {
    const index = fixture.memoCursor++;
    const previous = fixture.memos[index];
    if (!previous || dependencies.some((dependency, i) => !Object.is(dependency, previous.dependencies[i]))) {
      fixture.memos[index] = { dependencies, value: undefined };
      callback();
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
vi.mock("@helpers/ui", () => ({ useMediaQuery: () => false }));
vi.mock("@ui/components", () => ({ Button: "button", EditorShell: "editor-shell", FilterBar: "filter-bar" }));
vi.mock("@ui/components/icon/Icons", () => ({ TrashIcon: "trash-icon" }));
vi.mock("@ui/components/panels/FlexPanel", () => ({ FlexPanel: "flex-panel" }));
vi.mock("@shared/ui/components/toast/useToast", () => ({ useToast: () => ({ showToast: fixture.showToast }) }));
import { EventRegistrationFormPanel } from "../../../src/app/modules/admin/singleEvent/components/EventRegistrationFormPanel";

const orgA = "11111111-1111-4111-8111-111111111111";
const eventA = "22222222-2222-4222-8222-222222222222";
const fieldA = "33333333-3333-4333-8333-333333333333";
const fieldB = "44444444-4444-4444-8444-444444444444";
const field: EventFormField = {
  id: fieldA, eventId: eventA, label: "First", fieldKey: "first", fieldType: "text", options: null,
  isRequired: false, isActive: true, sortOrder: 1, createdAt: "2026-10-01", updatedAt: "2026-10-03",
};
const client = createClient("https://fixture.example.invalid", "fixture-public-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (url, options) => fixture.fetch(url, options) },
});
const timers: (() => void)[] = [];
let fields: EventFormField[] = [];
let groups: EventFormFieldGroup[] = [];
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
  value?: unknown; children?: unknown; className?: string; placeholder?: string; maxLength?: number;
  "aria-label"?: string;
};
function nodes(value: unknown): ReactElement<ActionProps>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<ActionProps>(value)) return [];
  return [value, ...Object.values(value.props).flatMap(nodes)];
}
function PanelProbe() {
  return EventRegistrationFormPanel({
    supabase: client, orgId: fixture.orgId, event: { id: fixture.eventId },
    fields, fieldsGroups: groups, onChanged: fixture.changed,
  });
}
function render() {
  let tree: ReturnType<typeof PanelProbe>;
  do {
    fixture.dirty = false;
    fixture.memoCursor = 0; fixture.stateCursor = 0; fixture.refCursor = 0; fixture.subscriptionCursor = 0;
    tree = PanelProbe();
  } while (fixture.dirty);
  return tree;
}
function action(label: string) {
  const node = nodes(render()).find((entry) => entry.props.children === label || entry.props["aria-label"] === label);
  if (!node?.props.onClick) throw new Error(`Missing real panel action ${label}`);
  return node.props.onClick;
}
function editLabel(value: string) {
  const input = nodes(render()).find((entry) => entry.type === "input" && entry.props.maxLength === 100 && !entry.props.placeholder);
  if (!input?.props.onChange) throw new Error("Missing real field/group label input");
  input.props.onChange({ target: { value } });
}
function currentLabel() {
  return nodes(render()).find((entry) => entry.type === "input" && entry.props.maxLength === 100 && !entry.props.placeholder)?.props.value;
}
function createDraft() { action("Ajouter un champ")(); editLabel("Submitted"); }
function replaceScope(change: string) {
  if (change === "session") fixture.session = session("B");
  if (change === "organization") fixture.orgId = fieldB;
  if (change === "event") fixture.eventId = fieldB;
  if (change === "unmount") {
    fixture.subscriptions.forEach(({ cleanup }) => cleanup()); fixture.subscriptions = []; return;
  }
  render();
}
function labels() {
  return nodes(render()).filter((entry) => entry.props.className === "adminRegTitleLine").map((entry) => entry.props.children);
}
beforeEach(() => {
  fixture.session = session(); fixture.orgId = orgA; fixture.eventId = eventA;
  fixture.memoCursor = 0; fixture.memos = []; fixture.stateCursor = 0; fixture.states = [];
  fixture.refCursor = 0; fixture.refs = []; fixture.subscriptionCursor = 0; fixture.subscriptions = [];
  fixture.fetch.mockReset(); fixture.showToast.mockClear(); fixture.changed.mockClear(); timers.length = 0; fields = []; groups = [];
  vi.stubGlobal("window", { setTimeout: (callback: () => void) => { timers.push(callback); return timers.length; }, clearTimeout: vi.fn() });
});
afterEach(() => { fixture.subscriptions.forEach(({ cleanup }) => cleanup()); vi.unstubAllGlobals(); });

describe("form panel continuations with real mutation hooks and Edge repositories", () => {
  it("saves in the current scope across JWT refresh and closes only the saved draft", async () => {
    const response = deferred<Response>();
    fixture.fetch.mockImplementationOnce(() => response.promise);
    createDraft();
    const pending = action("Ajouter")();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    fixture.session = session("A", 2); render();
    response.resolve(Response.json({ ...field, label: "Submitted", fieldKey: "submitted" }));
    await pending;
    expect(fixture.changed).toHaveBeenCalledOnce();
    expect(fixture.showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    timers.forEach((timer) => timer());
    expect(currentLabel()).toBeUndefined();
  });

  it.each(["session", "organization", "event", "unmount"])("ignores late create callbacks after %s changes", async (change) => {
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    createDraft(); const pending = action("Ajouter")();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    replaceScope(change); response.resolve(Response.json(field)); await pending;
    expect(fixture.changed).not.toHaveBeenCalled(); expect(fixture.showToast).not.toHaveBeenCalled(); expect(timers).toHaveLength(0);
  });

  it("preserves a newer field draft and suppresses old save notifications and closing", async () => {
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    createDraft(); const pending = action("Ajouter")();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    editLabel("Unsaved new draft"); response.resolve(Response.json(field)); await pending;
    expect(currentLabel()).toBe("Unsaved new draft"); expect(fixture.changed).not.toHaveBeenCalled();
    expect(fixture.showToast).not.toHaveBeenCalled(); expect(timers).toHaveLength(0);
  });

  it("preserves a failed draft and displays the controlled field-key conflict", async () => {
    fixture.fetch.mockResolvedValueOnce(Response.json({ error: "DUPLICATE_FIELD_KEY" }, { status: 409 }));
    createDraft(); await action("Ajouter")();
    expect(currentLabel()).toBe("Submitted"); expect(fixture.changed).not.toHaveBeenCalled();
    expect(fixture.showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
    expect(timers).toHaveLength(0);
  });

  it("sends one atomic field swap and keeps local order and scroll on success", async () => {
    fields = [field, { ...field, id: fieldB, label: "Second", fieldKey: "second", sortOrder: 2 }];
    fixture.fetch.mockResolvedValueOnce(Response.json({ success: true }));
    await action("Descendre")();
    expect(fixture.fetch).toHaveBeenCalledOnce();
    const [url, options] = fixture.fetch.mock.calls[0];
    expect(String(url)).toContain("/events/forms/reorder");
    expect(JSON.parse(String(options?.body))).toEqual({
      eventId: eventA, fields: [{ id: fieldA, sortOrder: 2 }, { id: fieldB, sortOrder: 1 }], groups: [],
    });
    expect(labels()).toEqual(["Second", "First"]); expect(fixture.changed).not.toHaveBeenCalled();
  });

  it("restores optimistic field order after a failed atomic reorder", async () => {
    fields = [field, { ...field, id: fieldB, label: "Second", fieldKey: "second", sortOrder: 2 }];
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    const pending = action("Descendre")();
    expect(labels()).toEqual(["Second", "First"]);
    response.resolve(Response.json({ error: "FORBIDDEN" }, { status: 403 })); await pending;
    expect(labels()).toEqual(["First", "Second"]); expect(fixture.fetch).toHaveBeenCalledOnce();
    expect(fixture.changed).not.toHaveBeenCalled();
    expect(fixture.showToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("ignores late reorder success and errors after replacing the organization", async () => {
    fields = [field, { ...field, id: fieldB, label: "Second", fieldKey: "second", sortOrder: 2 }];
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    const pending = action("Descendre")(); await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    replaceScope("organization"); response.resolve(Response.json({ error: "FORBIDDEN" }, { status: 403 })); await pending;
    expect(fixture.showToast).not.toHaveBeenCalled(); expect(fixture.changed).not.toHaveBeenCalled();
  });

  it("does not announce a failed field toggle as a success", async () => {
    fields = [field]; fixture.fetch.mockResolvedValueOnce(Response.json({ error: "FORBIDDEN" }, { status: 403 }));
    await action("Rendre requis")();
    expect(fixture.changed).not.toHaveBeenCalled();
    expect(fixture.showToast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ variant: "error" }));
  });

  it("keeps a new draft when a previous close animation finishes", () => {
    createDraft(); action("Fermer")(); editLabel("New unsaved draft");
    timers.forEach((timer) => timer()); expect(currentLabel()).toBe("New unsaved draft");
  });

  it("keeps unsaved edits when a saved field response arrives for an older draft", async () => {
    fields = [field];
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    action("Modifier")(); editLabel("Submitted");
    const pending = action("Enregistrer")();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    editLabel("New unsaved field"); response.resolve(Response.json({ ...field, label: "Submitted" })); await pending;
    expect(currentLabel()).toBe("New unsaved field"); expect(timers).toHaveLength(0);
    expect(fixture.changed).not.toHaveBeenCalled(); expect(fixture.showToast).not.toHaveBeenCalled();
  });

  it("ignores a late group save and preserves a new field opened during the request", async () => {
    groups = [{ id: fieldB, eventId: eventA, label: "Guests", sortOrder: 1, isActive: true, createdAt: "2026-10-01", updatedAt: "2026-10-03" }];
    fields = [{ ...field, groupId: fieldB }];
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    action("Modifier")(); editLabel("Submitted group");
    const pending = action("Enregistrer")();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    action("Ajouter un champ")(); editLabel("New unsaved field");
    response.resolve(Response.json({ ...groups[0], label: "Submitted group" })); await pending;
    expect(currentLabel()).toBe("New unsaved field"); expect(timers).toHaveLength(0);
    expect(fixture.changed).not.toHaveBeenCalled(); expect(fixture.showToast).not.toHaveBeenCalled();
  });

  it("swaps both groups in one request and reloads only after success", async () => {
    const groupA = "55555555-5555-4555-8555-555555555555";
    const groupB = "66666666-6666-4666-8666-666666666666";
    groups = [
      { id: groupA, eventId: eventA, label: "Guests", sortOrder: 1, isActive: true, createdAt: "2026-10-01", updatedAt: "2026-10-03" },
      { id: groupB, eventId: eventA, label: "Other", sortOrder: 2, isActive: true, createdAt: "2026-10-01", updatedAt: "2026-10-03" },
    ];
    fields = [{ ...field, groupId: groupA }];
    fixture.fetch.mockResolvedValueOnce(Response.json({ success: true }));
    await action("↓")();
    expect(fixture.fetch).toHaveBeenCalledOnce();
    const [url, options] = fixture.fetch.mock.calls[0];
    expect(String(url)).toContain("/events/forms/reorder");
    expect(JSON.parse(String(options?.body))).toEqual({ eventId: eventA, fields: [], groups: [
      { id: groupA, sortOrder: 2 }, { id: groupB, sortOrder: 1 },
    ] });
    expect(fixture.changed).toHaveBeenCalledOnce();
  });

  it("does not clear new group name input when an older group create finishes", async () => {
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    function groupName() { return nodes(render()).find((entry) => entry.type === "input" && entry.props.placeholder?.startsWith("Nom du groupe")); }
    groupName()?.props.onChange?.({ target: { value: "Submitted group" } });
    const pending = action("Ajouter un groupe")();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    groupName()?.props.onChange?.({ target: { value: "New unsaved group" } });
    response.resolve(Response.json({ id: fieldB, eventId: eventA, label: "Submitted group", sortOrder: 1, isActive: true, createdAt: "2026-10-01", updatedAt: "2026-10-03" }));
    await pending;
    expect(groupName()?.props.value).toBe("New unsaved group");
    expect(fixture.changed).not.toHaveBeenCalled(); expect(fixture.showToast).not.toHaveBeenCalled();
  });

  it.each([true, false])("ignores superseded reorder result after a props reload (success: %s)", async (success) => {
    fields = [field, { ...field, id: fieldB, label: "Second", fieldKey: "second", sortOrder: 2 }];
    const response = deferred<Response>(); fixture.fetch.mockImplementationOnce(() => response.promise);
    const pending = action("Descendre")();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    fields = [
      { ...field, sortOrder: 4, updatedAt: "2026-10-04" },
      { ...field, id: fieldB, label: "Second", fieldKey: "second", sortOrder: 3, updatedAt: "2026-10-04" },
    ];
    expect(labels()).toEqual(["Second", "First"]);
    response.resolve(success ? Response.json({ success: true }) : Response.json({ error: "FORBIDDEN" }, { status: 403 }));
    await pending;
    expect(labels()).toEqual(["Second", "First"]);
    expect(fixture.showToast).not.toHaveBeenCalled(); expect(timers).toHaveLength(0);
    expect(fixture.changed).not.toHaveBeenCalled();
  });
});
