import { isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  states: [] as unknown[], cursor: 0,
  query: { data: null as unknown, loading: false, error: null, reload: vi.fn(async () => {}) },
  organizationId: "org-A",
  onboard: vi.fn<(payload: unknown, token: string) => Promise<void>>(async () => {}),
  changeAdmin: vi.fn(async () => {}), changeOrganization: vi.fn(async () => {}),
  sendEmailCampaign: vi.fn(async () => ({ status: "partial", sentCount: 1, failedCount: 1, recipientCount: 2 })),
  values: { ownerEmail: "owner@example.test", organizationName: "Fixture", reason: "Fixture reason" } as Record<string, string>,
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = fixture.cursor++;
    if (!(index in fixture.states)) fixture.states[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.states[index], (value: unknown) => { fixture.states[index] = value; }];
  },
  useMemo: (compute: () => unknown) => compute(),
}));
vi.mock("react-router-dom", () => ({ Link: "a", useParams: () => ({ organizationId: fixture.organizationId }) }));
vi.mock("../../../src/app/modules/platform/hooks/usePlatformQuery", () => ({ usePlatformQuery: () => fixture.query }));
vi.mock("../../../src/app/modules/platform/data/platformAdminRepo", () => ({ platformAdminRepo: {
  onboard: fixture.onboard, changeAdmin: fixture.changeAdmin, changeOrganization: fixture.changeOrganization,
  sendEmailCampaign: fixture.sendEmailCampaign,
} }));
vi.mock("../../../src/app/modules/platform/security/PlatformSecurityContext", () => ({ usePlatformSecurity: () => ({
  runCritical: async (_action: string, _target: string, _label: string, execute: (token: string) => Promise<unknown>) => execute("fixture-proof"),
}) }));
import { PlatformOnboardingPage } from "../../../src/app/modules/platform/pages/PlatformOnboardingPage";
import { PlatformAdminsPage } from "../../../src/app/modules/platform/pages/PlatformAdminsPage";
import { PlatformOrganizationPage } from "../../../src/app/modules/platform/pages/PlatformOrganizationPage";
import { PlatformCommunicationsPage } from "../../../src/app/modules/platform/pages/PlatformCommunicationsPage";

type Props = { children?: ReactNode; onSubmit?: (event: { preventDefault(): void; currentTarget: unknown }) => Promise<void>; disabled?: boolean };
function forms(node: ReactNode): Props[] {
  if (Array.isArray(node)) return node.flatMap(forms);
  if (!isValidElement<Props>(node)) return [];
  return [...(node.type === "form" ? [node.props] : []), ...forms(node.props.children)];
}
function render(page: () => ReactNode) { fixture.cursor = 0; return page(); }
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.states = []; fixture.cursor = 0;
  fixture.query = { data: null, loading: false, error: null, reload: vi.fn(async () => {}) };
  fixture.organizationId = "org-A";
  vi.stubGlobal("FormData", class { get(key: string) { return fixture.values[key] ?? ""; } });
});
describe("platform mutation form lifecycle", () => {
  it("resets the captured onboarding form only after confirmed success", async () => {
    const pending = deferred(); fixture.onboard.mockImplementationOnce(() => pending.promise);
    const reset = vi.fn(); const event: { preventDefault(): void; currentTarget: unknown } = { preventDefault() {}, currentTarget: { reset } };
    const key = fixture.states[3];
    const submit = forms(render(PlatformOnboardingPage))[0]?.onSubmit;
    const initialKey = fixture.states[3];
    const result = submit?.(event); event.currentTarget = null;
    expect(reset).not.toHaveBeenCalled(); expect(fixture.states[3]).toBe(initialKey);
    pending.resolve(); await result; for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(reset).toHaveBeenCalledOnce(); expect(fixture.states[0]).toBeNull(); expect(fixture.states[1]).toBe(true);
    expect(fixture.states[3]).not.toBe(initialKey); expect(key).toBeUndefined();
  });
  it("retains the onboarding idempotency key after a failed attempt", async () => {
    fixture.onboard.mockRejectedValueOnce(new Error("fixture failure"));
    const submit = forms(render(PlatformOnboardingPage))[0]?.onSubmit; const key = fixture.states[3];
    const reset = vi.fn(); await submit?.({ preventDefault() {}, currentTarget: { reset } });
    expect(reset).not.toHaveBeenCalled(); expect(fixture.states[3]).toBe(key);
  });
  it("resets the captured admin grant form after an asynchronous grant", async () => {
    const pending = deferred(); fixture.changeAdmin.mockImplementationOnce(() => pending.promise);
    const reset = vi.fn(); const event: { preventDefault(): void; currentTarget: unknown } = { preventDefault() {}, currentTarget: { reset } };
    const result = forms(render(PlatformAdminsPage))[0]?.onSubmit?.(event); event.currentTarget = null;
    pending.resolve(); await result; for (let i = 0; i < 8; i++) await Promise.resolve(); expect(reset).toHaveBeenCalledOnce(); expect(fixture.states[0]).toBeNull();
  });
  it.each([true, false])("refuses every mutation when data identity mismatches the URL (loading=%s)", async (loading) => {
    fixture.organizationId = "org-B";
    fixture.query.data = { organization: { id: "org-A", name: "A" }, metrics: {}, members: [], recentEvents: [] };
    fixture.query.loading = loading;
    const actions = forms(render(PlatformOrganizationPage)); expect(actions).toHaveLength(3);
    for (const action of actions) await action.onSubmit?.({ preventDefault() {}, currentTarget: {} });
    expect(fixture.changeOrganization).not.toHaveBeenCalled();
  });
  it("targets exactly the loaded URL organization for all three mutations", async () => {
    fixture.organizationId = "org-B";
    fixture.query.data = { organization: { id: "org-B", name: "B" }, metrics: {}, members: [], recentEvents: [] };
    const actions = forms(render(PlatformOrganizationPage));
    for (const action of actions) {
      action.onSubmit?.({ preventDefault() {}, currentTarget: {} });
      for (let i = 0; i < 8; i++) await Promise.resolve();
    }
    expect(fixture.changeOrganization.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ["org-B", "status"], ["org-B", "plan"], ["org-B", "owner"],
    ]);
  });
  it("retains the campaign payload and key after partial failure for an explicit retry", async () => {
    render(PlatformCommunicationsPage);
    fixture.states[4] = "Fixture subject"; fixture.states[5] = "Fixture body"; fixture.states[6] = "Fixture reason";
    const key = fixture.states[7];
    const submit = forms(render(PlatformCommunicationsPage)).at(-1)?.onSubmit;
    submit?.({ preventDefault() {}, currentTarget: {} });
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(fixture.states.slice(4, 8)).toEqual(["Fixture subject", "Fixture body", "Fixture reason", key]);
    expect(fixture.states[10]).toContain("trois tentatives maximum");
  });
});
