import type { Session } from "@supabase/supabase-js";
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted((): {
  session: Session | null; orgId: string; fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  memoCursor: number; memos: { dependencies: readonly unknown[]; value: unknown }[];
  stateCursor: number; states: unknown[]; refCursor: number; refs: { current: unknown }[];
  subscriptionCursor: number; subscriptions: { subscribe: unknown; cleanup: () => void }[];
  refetch: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn>;
} => ({
  session: null, orgId: "", fetch: vi.fn<typeof globalThis.fetch>(), memoCursor: 0, memos: [],
  stateCursor: 0, states: [], refCursor: 0, refs: [], subscriptionCursor: 0, subscriptions: [],
  refetch: vi.fn(async () => undefined), navigate: vi.fn(),
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
vi.mock("@gateways/supabase/supabaseClient", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fixture.fetch(url, options) },
  }) };
});
vi.mock("react-router-dom", async (original) => ({
  ...await original<typeof import("react-router-dom")>(),
  useNavigate: () => fixture.navigate,
  useOutletContext: () => ({ orgId: fixture.orgId, refetch: fixture.refetch, events: [], bootstrap: {} }),
}));
import AdminEventsPage from "../../../src/app/modules/admin/events/pages/AdminEventsPage";
import { createAdminDashboardStore } from "../../../src/app/modules/admin/dashboard/hooks/useAdminDashboardData";
import { dashboardBootstrapSchema } from "../../../shared/schemas/organizations";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const event = {
  id: "33333333-3333-4333-8333-333333333333", orgId: orgA, slug: "event-fixture", title: "Event fixture",
  isPublished: false, createdAt: "2026-10-01", updatedAt: "2026-10-03",
};
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
type ActionProps = { onClick?: () => Promise<void>; label?: string };
function nodes(value: unknown): ReactElement<ActionProps>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<ActionProps>(value)) return [];
  return [value, ...Object.values(value.props).flatMap(nodes)];
}
function PageProbe() {
  fixture.memoCursor = 0; fixture.stateCursor = 0; fixture.refCursor = 0; fixture.subscriptionCursor = 0;
  return AdminEventsPage();
}
function addEvent() {
  const action = nodes(PageProbe()).find((node) => node.props.label === "Nouvel événement")?.props.onClick;
  if (!action) throw new Error("Missing real event creation action");
  return action;
}
function changeScope(change: string) {
  if (change === "session") fixture.session = session("B");
  if (change === "organization") fixture.orgId = orgB;
  if (change === "unmount") {
    fixture.subscriptions.forEach(({ cleanup }) => cleanup()); fixture.subscriptions = []; return;
  }
  PageProbe();
}
beforeEach(() => {
  fixture.session = session(); fixture.orgId = orgA;
  fixture.memoCursor = 0; fixture.memos = []; fixture.stateCursor = 0; fixture.states = [];
  fixture.refCursor = 0; fixture.refs = []; fixture.subscriptionCursor = 0; fixture.subscriptions = [];
  fixture.fetch.mockReset(); fixture.navigate.mockClear(); fixture.refetch.mockReset();
  fixture.refetch.mockResolvedValue(undefined);
});
afterEach(() => { fixture.subscriptions.forEach(({ cleanup }) => cleanup()); });

describe("event page mutation continuations with real hooks and Edge repository", () => {
  it("keeps the event page subscribed and navigates through the real dashboard refresh", async () => {
    const bootstrap = dashboardBootstrapSchema.parse({
      profile: { userId: orgA, createdAt: "2026-10-03", updatedAt: "2026-10-03" },
      membership: [], organizationProfile: null, subscription: null,
      organization: {
        id: orgA, createdBy: orgA, type: "association", name: "Organization A",
        status: "active", createdAt: "2026-10-03", paymentsProvider: "stripe",
        paymentsStatus: "not_connected", paymentsLiveReady: false,
        plan: "free", planStartedAt: "2026-10-03", planExpiresAt: null,
      },
      planLimits: {
        plan: null, maxEventsPerYear: null, maxRegistrationsPerEvent: null,
        maxProductsPerEvent: null, maxFormFields: null, maxAdmins: null,
        brandingRequired: true, customDomainAllowed: false, apiAccess: false,
        advancedAnalytics: false, promoCodes: false, automatedEmails: false,
      },
    });
    const loaded = { loading: false, error: null, bootstrap, orgId: orgA, eventsOverview: null, events: [] };
    let response = Promise.resolve(loaded);
    const dashboard = createAdminDashboardStore(async (_current, onOrganizationResolved) => {
      onOrganizationResolved(orgA);
      return response;
    });
    let unmounted = false;
    const unsubscribe = dashboard.subscribe(() => {
      const state = dashboard.getSnapshot();
      // AdminDashboard replaces its Outlet with the initial loading screen
      // exactly under this condition. Model that real parent lifecycle here.
      if (state.loading && !state.bootstrap && fixture.subscriptions.length > 0) {
        unmounted = true;
        changeScope("unmount");
      }
    });
    try {
      await vi.waitFor(() => expect(dashboard.getSnapshot().bootstrap).toBe(bootstrap));
      const pendingReload = deferred<typeof loaded>();
      response = pendingReload.promise;
      fixture.refetch.mockImplementation(() => dashboard.refetch());
      fixture.fetch.mockResolvedValueOnce(Response.json(event));
      const pending = addEvent()();
      await vi.waitFor(() => expect(fixture.refetch).toHaveBeenCalledOnce());
      expect(dashboard.getSnapshot().loading).toBe(true);
      expect(unmounted).toBe(false);
      pendingReload.resolve(loaded);
      await pending;
      expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith("/admin/events/event-fixture");
    } finally {
      unsubscribe();
    }
  });

  it("preserves a current creation through JWT refresh and navigates after dashboard reload", async () => {
    const reload = deferred<void>();
    fixture.fetch.mockResolvedValueOnce(Response.json(event));
    fixture.refetch.mockImplementationOnce(() => reload.promise);
    const pending = addEvent()();
    await vi.waitFor(() => expect(fixture.refetch).toHaveBeenCalledOnce());
    fixture.session = session("A", 2);
    PageProbe();
    reload.resolve();
    await pending;
    expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith("/admin/events/event-fixture");
  });

  it.each(["session", "organization", "unmount"])("does not navigate after %s changes during dashboard reload after creation", async (change) => {
    const reload = deferred<void>();
    fixture.fetch.mockResolvedValueOnce(Response.json(event));
    fixture.refetch.mockImplementationOnce(() => reload.promise);
    const pending = addEvent()();
    await vi.waitFor(() => expect(fixture.refetch).toHaveBeenCalledOnce());
    changeScope(change);
    reload.resolve();
    await pending;
    expect(fixture.navigate).not.toHaveBeenCalled();
  });

  it.each(["session", "organization", "unmount"])("does not reload or navigate after %s changes while the creation request is pending", async (change) => {
    const response = deferred<Response>();
    fixture.fetch.mockImplementationOnce(() => response.promise);
    const pending = addEvent()();
    await vi.waitFor(() => expect(fixture.fetch).toHaveBeenCalledOnce());
    changeScope(change);
    response.resolve(Response.json(event));
    await pending;
    expect(fixture.refetch).not.toHaveBeenCalled();
    expect(fixture.navigate).not.toHaveBeenCalled();
  });
});
