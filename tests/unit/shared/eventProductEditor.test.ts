import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventProducts } from "../../../shared/schemas/event-products-data";
import type { CreateEventProductInput } from "../../../shared/schemas/event-products";

const lifecycle = vi.hoisted((): {
  memoCursor: number; memos: { dependencies: readonly unknown[]; value: unknown }[];
  stateCursor: number; states: unknown[]; refCursor: number; refs: { current: unknown }[];
  effects: (() => unknown)[];
} => ({ memoCursor: 0, memos: [], stateCursor: 0, states: [], refCursor: 0, refs: [], effects: [] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (callback: () => unknown, dependencies: readonly unknown[]) => {
    const index = lifecycle.memoCursor++;
    const previous = lifecycle.memos[index];
    if (!previous || dependencies.length !== previous.dependencies.length || dependencies.some((dependency, i) => !Object.is(dependency, previous.dependencies[i]))) {
      lifecycle.memos[index] = { dependencies, value: callback() };
    }
    return lifecycle.memos[index].value;
  },
  useState: (initial: unknown) => {
    const index = lifecycle.stateCursor++;
    if (!Object.prototype.hasOwnProperty.call(lifecycle.states, index)) lifecycle.states[index] = initial;
    return [lifecycle.states[index], (next: unknown) => {
      lifecycle.states[index] = typeof next === "function" ? next(lifecycle.states[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = lifecycle.refCursor++;
    lifecycle.refs[index] ??= { current: initial };
    return lifecycle.refs[index];
  },
  useEffect: (callback: () => unknown) => lifecycle.effects.push(callback),
}));
import { useEventTicketsEditor } from "../../../src/app/modules/admin/tickets/hooks/useEventTicketsEditor";
import { OrganizerMutationObsoleteError, createScopedEventMutationStore } from "../../../src/app/modules/admin/singleEvent/hooks/useScopedEventMutation";

const eventId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const products: EventProducts = [{
  id: productId, eventId, name: "Ticket", priceCents: 0, stockQty: 0, sortOrder: 1,
  reservedQty: 0, soldQty: 0, createdAt: "2026-10-01", updatedAt: "2026-10-03",
}];
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(rows: EventProducts = []) {
  let current = true;
  const callbacks = {
    onCreate: vi.fn<(input: CreateEventProductInput) => Promise<void>>(),
    onUpdate: vi.fn<() => Promise<void>>(), onRemove: vi.fn<() => Promise<void>>(),
    onChanged: vi.fn(), onActionSuccess: vi.fn(), onActionError: vi.fn(),
  };
  const timers: (() => void)[] = [];
  const setTimeout = vi.fn((callback: () => void) => { timers.push(callback); return timers.length; });
  vi.stubGlobal("window", { setTimeout, clearTimeout: vi.fn(), confirm: () => true });
  function EditorProbe() {
    return useEventTicketsEditor({ eventId, products: rows, ...callbacks, isCurrentScope: () => current });
  }
  function render() {
    lifecycle.memoCursor = 0; lifecycle.stateCursor = 0; lifecycle.refCursor = 0;
    return EditorProbe();
  }
  render();
  lifecycle.effects.splice(0).forEach((effect) => effect());
  return { ...callbacks, render, timers, setTimeout, replaceScope: () => { current = false; } };
}
beforeEach(() => {
  lifecycle.memoCursor = 0; lifecycle.memos = []; lifecycle.stateCursor = 0; lifecycle.states = [];
  lifecycle.refCursor = 0; lifecycle.refs = []; lifecycle.effects = [];
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("ticket editor mutation continuations", () => {
  it("preserves zero stock and closes the saved draft in the current scope", async () => {
    const editor = setup();
    editor.onCreate.mockResolvedValue(undefined);
    editor.render().openCreate();
    editor.render().setEditing((previous) => previous ? { ...previous, name: "Ticket", stockQty: 0 } : previous);
    await editor.render().saveEditor();
    expect(editor.onCreate).toHaveBeenCalledWith(expect.objectContaining({ eventId, name: "Ticket", stockQty: 0 }));
    expect(editor.onActionSuccess).toHaveBeenCalledExactlyOnceWith("created");
    expect(editor.onChanged).toHaveBeenCalledOnce();
    editor.timers.forEach((callback) => callback());
    expect(editor.render().editing).toBeNull();
  });

  it("keeps a newer draft edited while the previous save was pending", async () => {
    const editor = setup();
    const response = deferred<void>();
    editor.onCreate.mockImplementationOnce(() => response.promise);
    editor.render().openCreate();
    editor.render().setEditing((previous) => previous ? { ...previous, name: "Submitted" } : previous);
    const pending = editor.render().saveEditor();
    editor.render().setEditing((previous) => previous ? { ...previous, name: "Unsaved new draft", stockQty: 0 } : previous);
    response.resolve();
    await pending;
    expect(editor.render().editing?.name).toBe("Unsaved new draft");
    expect(editor.render().editing?.stockQty).toBe(0);
    expect(editor.setTimeout).not.toHaveBeenCalled();
    expect(editor.onActionSuccess).not.toHaveBeenCalled();
    expect(editor.onChanged).not.toHaveBeenCalled();
  });

  it("does not close, announce success or reload after replacing the identity/event scope", async () => {
    const editor = setup();
    const response = deferred<void>();
    editor.onCreate.mockImplementationOnce(() => response.promise);
    editor.render().openCreate();
    editor.render().setEditing((previous) => previous ? { ...previous, name: "Ticket" } : previous);
    const pending = editor.render().saveEditor();
    editor.replaceScope();
    response.resolve();
    await pending;
    expect(editor.setTimeout).not.toHaveBeenCalled();
    expect(editor.onActionSuccess).not.toHaveBeenCalled();
    expect(editor.onChanged).not.toHaveBeenCalled();
  });

  it("ignores obsolete and late error results while preserving a current failed draft", async () => {
    const editor = setup();
    editor.render().openCreate();
    editor.render().setEditing((previous) => previous ? { ...previous, name: "Ticket" } : previous);
    editor.onCreate.mockRejectedValueOnce(new OrganizerMutationObsoleteError());
    await editor.render().saveEditor();
    expect(editor.onActionError).not.toHaveBeenCalled();
    editor.onCreate.mockRejectedValueOnce(new Error("Stock invalide"));
    await editor.render().saveEditor();
    expect(editor.onActionError).toHaveBeenCalledExactlyOnceWith("Stock invalide");
    expect(editor.render().editing?.name).toBe("Ticket");
    expect(editor.setTimeout).not.toHaveBeenCalled();
  });

  it("stops a two-step reorder before the second mutation after scope replacement", async () => {
    const editor = setup([...products, { ...products[0], id: "33333333-3333-4333-8333-333333333333", sortOrder: 2 }]);
    const response = deferred<void>();
    editor.onUpdate.mockImplementationOnce(() => response.promise);
    const pending = editor.render().movePersisted(productId, 1);
    expect(editor.onUpdate).toHaveBeenCalledOnce();
    editor.replaceScope();
    response.resolve();
    await pending;
    expect(editor.onUpdate).toHaveBeenCalledOnce();
    expect(editor.onActionSuccess).not.toHaveBeenCalled();
    expect(editor.onChanged).not.toHaveBeenCalled();
  });

  it("does not let a pending close timer clear a newer draft", async () => {
    const editor = setup(products);
    editor.render().openEdit(editor.render().sorted[0]);
    editor.render().closeEditor();
    editor.render().openCreate();
    editor.render().setEditing((previous) => previous ? { ...previous, name: "New draft" } : previous);
    editor.timers.forEach((callback) => callback());
    expect(editor.render().editing?.name).toBe("New draft");
  });
});

describe("scoped products preserve throwing hook contracts", () => {
  it("propagates current errors and ignores late failures after reset", async () => {
    const failure = deferred<string>();
    const store = createScopedEventMutationStore(() => failure.promise, "Save failed", true, true);
    store.subscribe(vi.fn());
    const pending = store.mutate(undefined);
    failure.reject(new Error("Current failure"));
    await expect(pending).rejects.toThrow("Current failure");
    expect(store.getSnapshot().error).toBe("Current failure");
    const obsolete = deferred<string>();
    const old = createScopedEventMutationStore(() => obsolete.promise, "Save failed", true, true);
    old.subscribe(vi.fn());
    const stale = old.mutate(undefined);
    old.reset();
    obsolete.reject(new Error("Old account failure"));
    await expect(stale).resolves.toBeNull();
    expect(old.getSnapshot().error).toBeNull();
  });
});
