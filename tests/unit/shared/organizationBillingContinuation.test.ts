import type { Session } from "@supabase/supabase-js";
import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationBillingPatch } from "../../../shared/schemas/organization-billing";

const fixture = vi.hoisted((): {
  session: Session | null; orgId: string; fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
  memoCursor: number; memos: { dependencies: readonly unknown[]; value: unknown }[];
  stateCursor: number; states: unknown[]; setCount: number;
  subscriptionCursor: number; subscriptions: { subscribe: unknown; cleanup: () => void }[];
  showToast: ReturnType<typeof vi.fn>; refetch: ReturnType<typeof vi.fn>;
} => ({
  session: null, orgId: "", fetch: vi.fn<typeof globalThis.fetch>(), memoCursor: 0, memos: [],
  stateCursor: 0, states: [], setCount: 0, subscriptionCursor: 0, subscriptions: [],
  showToast: vi.fn(), refetch: vi.fn(async () => undefined),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => undefined,
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
    if (!Object.prototype.hasOwnProperty.call(fixture.states, index)) {
      fixture.states[index] = typeof initial === "function" ? initial() : initial;
    }
    return [fixture.states[index], (next: unknown) => {
      fixture.setCount++;
      fixture.states[index] = typeof next === "function" ? next(fixture.states[index]) : next;
    }];
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
vi.mock("@shared/ui/components/toast/useToast", () => ({ useToast: () => ({ showToast: fixture.showToast }) }));
vi.mock("react-router-dom", async (original) => ({
  ...await original<typeof import("react-router-dom")>(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useOutletContext: () => ({
    orgId: fixture.orgId, refetch: fixture.refetch,
    bootstrap: {
      organization: { id: fixture.orgId, plan: "free", status: "active", planStartedAt: "2026-10-01" },
      subscription: null, planLimits: {},
    },
  }),
}));
import AdminSubscriptionPage from "../../../src/app/modules/admin/subscriptions/pages/AdminSubscriptionPage";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const billing = {
  orgId: orgA, legalName: "Association", addressLine1: "Rue des tests 1", postalCode: "1000",
  city: "Bruxelles", countryCode: "BE", isVatValidated: false, createdAt: "2026-10-01", updatedAt: "2026-10-03",
};
function session(id = "A"): Session {
  return {
    access_token: `${btoa('{}')}.${btoa(JSON.stringify({ session_id: `session-${id}` }))}.fixture`,
    refresh_token: `fixture-refresh-${id}`, token_type: "bearer", expires_in: 3600,
    user: { id, app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "2026-10-03" },
  };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}
type ActionProps = {
  children?: unknown; targetPlan?: string;
  onAction?: () => Promise<void>; onSave?: (patch: OrganizationBillingPatch) => Promise<void>;
};
function nodes(value: unknown): ReactElement<ActionProps>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<ActionProps>(value)) return [];
  return [value, ...nodes(value.props.children)];
}
function PageProbe() {
  fixture.memoCursor = 0;
  fixture.stateCursor = 0;
  fixture.subscriptionCursor = 0;
  return AdminSubscriptionPage();
}
function choosePro() {
  const action = nodes(PageProbe()).find((node) => node.props.targetPlan === "pro")?.props.onAction;
  if (!action) throw new Error("Missing real plan action");
  return action;
}
function saveBilling() {
  const action = nodes(PageProbe()).find((node) => typeof node.type === "function" && node.type.name === "BillingTab")?.props.onSave;
  if (!action) throw new Error("Missing real billing save action");
  return action;
}
function reads() {
  return fixture.fetch.mock.calls.filter(([url]) => String(url).endsWith("/organizations/billing/read"));
}
function subscriptionRequests() {
  return fixture.fetch.mock.calls.filter(([url]) => String(url).includes("/functions/v1/subscriptions"));
}
function changeScope(change: string) {
  if (change === "session") fixture.session = session("B");
  if (change === "organization") fixture.orgId = orgB;
  if (change === "unmount") {
    fixture.subscriptions.forEach(({ cleanup }) => cleanup());
    fixture.subscriptions = [];
    return;
  }
  PageProbe();
}

beforeEach(() => {
  fixture.session = session(); fixture.orgId = orgA;
  fixture.memoCursor = 0; fixture.memos = []; fixture.stateCursor = 0; fixture.states = [];
  fixture.setCount = 0; fixture.subscriptionCursor = 0; fixture.subscriptions = [];
  fixture.fetch.mockReset(); fixture.showToast.mockClear(); fixture.refetch.mockClear();
});
afterEach(() => { fixture.subscriptions.forEach(({ cleanup }) => cleanup()); });

// The real page closures, real billing hooks/repositories and real subscriptions
// repository run against controlled React state/subscriptions and HTTP fixtures.
describe("subscription caller billing continuations", () => {
  it("continues save and billing refresh into one subscription when the scope stays current", async () => {
    let saved = false;
    fixture.fetch.mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith("/organizations/billing/update")) {
        saved = true;
        return Promise.resolve(json(billing));
      }
      if (path.endsWith("/organizations/billing/read")) return Promise.resolve(json({ billing: saved ? billing : null }));
      if (path.endsWith("/subscriptions")) return Promise.resolve(json({
        ok: true, action: "invoice", provider: "manual", orgId: orgA, plan: "pro", status: "active",
        invoiceId: "33333333-3333-4333-8333-333333333333", invoiceNumber: "FIX-001",
        dueAt: "2026-10-13", currentPeriodEnd: "2026-11-03", reused: false, promoApplied: false,
        discountPercent: null, billingPriceValue: "25.99", warnings: [],
      }));
      throw new Error("Unexpected request");
    });
    await choosePro()();
    await vi.waitFor(() => expect(reads()).toHaveLength(2));
    await saveBilling()({ orgId: orgA, city: "Namur" });
    expect(subscriptionRequests()).toHaveLength(1);
    expect(subscriptionRequests()[0][1]?.body).toBe(JSON.stringify({ orgId: orgA, plan: "pro", promoCode: null }));
    expect(fixture.refetch).toHaveBeenCalledOnce();
  });

  it.each(["session", "organization", "unmount"])(
    "does not activate a plan after %s changes during billing refetch after save", async (change) => {
      const response = deferred<Response>();
      let pendingRead = false;
      fixture.fetch.mockImplementation((url) => {
        if (String(url).endsWith("/organizations/billing/update")) return Promise.resolve(json(billing));
        if (String(url).endsWith("/organizations/billing/read")) return pendingRead ? response.promise : Promise.resolve(json({ billing: null }));
        throw new Error("Unexpected request");
      });
      await choosePro()();
      await vi.waitFor(() => expect(reads()).toHaveLength(2));
      const save = saveBilling();
      pendingRead = true;
      const pending = save({ orgId: orgA, city: "Namur" });
      await vi.waitFor(() => expect(reads()).toHaveLength(3));
      changeScope(change);
      const stateWrites = fixture.setCount;
      fixture.showToast.mockClear();
      response.resolve(json({ billing }));
      await pending;
      expect(subscriptionRequests()).toHaveLength(0);
      expect(fixture.refetch).not.toHaveBeenCalled();
      expect(fixture.showToast).not.toHaveBeenCalled();
      expect(fixture.setCount).toBe(stateWrites);
    },
  );

  it.each(["session", "organization", "unmount"])(
    "does not change pending plans or start subscriptions after %s changes during the initial billing check", async (change) => {
      const response = deferred<Response>();
      fixture.fetch.mockImplementationOnce(() => response.promise);
      const pending = choosePro()();
      await vi.waitFor(() => expect(reads()).toHaveLength(1));
      changeScope(change);
      const stateWrites = fixture.setCount;
      response.resolve(json({ billing }));
      await pending;
      expect(subscriptionRequests()).toHaveLength(0);
      expect(fixture.showToast).not.toHaveBeenCalled();
      expect(fixture.setCount).toBe(stateWrites);
    },
  );
});
