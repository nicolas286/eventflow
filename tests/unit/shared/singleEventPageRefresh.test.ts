import { isValidElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventDetailAdminCore } from "../../../shared/schemas/events";

type CoreState = { loading: boolean; error: string | null; eventId: string | null; data: EventDetailAdminCore | null };
const fixture = vi.hoisted((): {
  store: { getSnapshot: () => CoreState; refetch: () => Promise<void>; isCurrentScope: () => boolean } | null;
  dashboard: ReturnType<typeof vi.fn>; unsubscribe: () => void;
} => ({ store: null, dashboard: vi.fn(async () => undefined), unsubscribe: () => undefined }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(), useMemo: (callback: () => unknown) => callback(),
}));
vi.mock("react-router-dom", () => ({
  useParams: () => ({ eventSlug: "event-fixture" }),
  useOutletContext: () => ({ orgId: "11111111-1111-4111-8111-111111111111", refetch: fixture.dashboard }),
  useNavigate: () => vi.fn(),
}));
vi.mock("@gateways/supabase/supabaseClient", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return { supabase: createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) };
});
vi.mock("../../../src/app/modules/admin/singleEvent/hooks/useAdminSingleEventCoreData", async (original) => ({
  ...await original<typeof import("../../../src/app/modules/admin/singleEvent/hooks/useAdminSingleEventCoreData")>(),
  useAdminSingleEventCoreData: () => {
    if (!fixture.store) throw new Error("Missing core fixture store");
    return { ...fixture.store.getSnapshot(), refetch: fixture.store.refetch, isCurrentScope: fixture.store.isCurrentScope };
  },
}));
vi.mock("../../../src/app/modules/admin/singleEvent/hooks/useUpdateEvent", () => ({
  useUpdateEvent: () => ({ error: null, isCurrentScope: () => true }),
}));
vi.mock("../../../src/app/modules/admin/singleEvent/hooks/useAdminSingleEventPageParams", () => ({
  useAdminSingleEventPageParams: () => ({ tab: "form", setTab: vi.fn(), searchParams: new URLSearchParams() }),
}));
vi.mock("../../../src/app/modules/admin/forms/components/SingleEventFormTab", () => ({ SingleEventFormSection: "form-section" }));
vi.mock("../../../src/app/modules/admin/tickets/components/SingleEventTicketsSection", () => ({ SingleEventTicketsSection: "tickets-section" }));
vi.mock("../../../src/app/modules/admin/singleEvent/components/SingleEventDetailsTab", () => ({ SingleEventDetailsSection: "details-section" }));
vi.mock("../../../src/app/modules/admin/orders/components/SingleEventParticipantsSection", () => ({ SingleEventParticipantsSection: "participants-section" }));
vi.mock("../../../src/app/modules/admin/promoCodes/components/SingleEventPromoCodesTabs", () => ({ SingleEventPromoCodesSection: "promo-section" }));
vi.mock("../../../src/app/modules/admin/singleEvent/components/AdminSingleEventTabs", () => ({ AdminSingleEventTabs: "tabs" }));
vi.mock("../../../src/app/modules/admin/dashboard/components/AdminPageHeader/AdminPageHeader", () => ({ AdminPageHeader: "page-header" }));
vi.mock("@ui/components", () => ({ Badge: "badge", Button: "button" }));
vi.mock("@ui/components/icon/Icons", () => ({ ChevronLeftIcon: "chevron-left" }));
import { AdminSingleEventPage } from "../../../src/app/modules/admin/singleEvent/pages/AdminSingleEventPage";
import { createAdminSingleEventCoreStore } from "../../../src/app/modules/admin/singleEvent/hooks/useAdminSingleEventCoreData";

const eventId = "22222222-2222-4222-8222-222222222222";
const data: EventDetailAdminCore = {
  event: {
    id: eventId, slug: "event-fixture", title: "Event fixture", isPublished: false, updatedAt: "2026-10-03",
    bannerUrlRaw: null, bannerUrlEffective: "https://example.invalid/banner.png",
  },
  orgBranding: { logoUrl: "https://example.invalid/logo.png", defaultEventBannerUrl: "https://example.invalid/banner.png" },
  products: [], formFields: [], formFieldsGroups: [],
};
type NodeProps = { onChanged?: () => Promise<void>; fields?: unknown; children?: unknown; className?: string };
function nodes(value: unknown): ReactElement<NodeProps>[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!isValidElement<NodeProps>(value)) return [];
  return [value, ...Object.values(value.props).flatMap(nodes)];
}
function form() { return nodes(AdminSingleEventPage()).find((node) => node.type === "form-section"); }
function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  let reject: (error: Error) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function setup(load: () => Promise<{ eventId: string; data: EventDetailAdminCore }>) {
  const store = createAdminSingleEventCoreStore(load);
  fixture.store = store;
  fixture.unsubscribe = store.subscribe(vi.fn());
}
beforeEach(() => { fixture.dashboard.mockClear(); });
afterEach(() => { fixture.unsubscribe(); fixture.store = null; });

describe("single event page preserves the mounted form section during same-scope refresh", () => {
  it("shows the initial loader without rendering an uninitialized panel", async () => {
    const response = deferred<{ eventId: string; data: EventDetailAdminCore }>();
    setup(() => response.promise);
    expect(form()).toBeUndefined();
    expect(nodes(AdminSingleEventPage()).some((node) => node.props.className === "adminEventEmpty")).toBe(true);
    response.resolve({ eventId, data });
    await vi.waitFor(() => expect(form()).toBeDefined());
  });

  it("keeps the section type, key and retained fields throughout a real pending core reload", async () => {
    let response = Promise.resolve({ eventId, data });
    setup(() => response);
    await vi.waitFor(() => expect(form()).toBeDefined());
    const before = form();
    const pending = deferred<{ eventId: string; data: EventDetailAdminCore }>();
    response = pending.promise;
    const refreshing = before?.props.onChanged?.();
    expect(fixture.store?.getSnapshot().loading).toBe(true);
    const during = form();
    expect(during).toBeDefined(); expect(during?.type).toBe(before?.type); expect(during?.key).toBe(before?.key);
    expect(during?.props.fields).toBe(before?.props.fields);
    expect(nodes(AdminSingleEventPage()).some((node) => node.props.className === "adminEventEmpty")).toBe(false);
    pending.resolve({ eventId, data: { ...data, event: { ...data.event, updatedAt: "2026-10-04" } } });
    await refreshing;
    expect(form()?.type).toBe(before?.type); expect(form()?.key).toBe(before?.key);
    expect(fixture.dashboard).toHaveBeenCalledOnce();
  });

  it("keeps the existing section and displays the alert when a refetch fails", async () => {
    let response = Promise.resolve({ eventId, data }); setup(() => response);
    await vi.waitFor(() => expect(form()).toBeDefined());
    const before = form(); const failed = deferred<{ eventId: string; data: EventDetailAdminCore }>(); response = failed.promise;
    const refreshing = before?.props.onChanged?.();
    failed.reject(new Error("Reload unavailable")); await refreshing;
    expect(form()?.type).toBe(before?.type); expect(form()?.key).toBe(before?.key);
    expect(form()?.props.fields).toBe(before?.props.fields);
    expect(nodes(AdminSingleEventPage()).some((node) => node.props.className === "adminEventAlert isError")).toBe(true);
  });

  it("removes retained old scope data when a new scoped store replaces the previous one", async () => {
    setup(async () => ({ eventId, data })); await vi.waitFor(() => expect(form()).toBeDefined());
    fixture.unsubscribe();
    const response = deferred<{ eventId: string; data: EventDetailAdminCore }>(); setup(() => response.promise);
    expect(form()).toBeUndefined();
    response.resolve({ eventId, data }); await vi.waitFor(() => expect(form()).toBeDefined());
  });
});
