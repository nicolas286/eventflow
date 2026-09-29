import { describe, expect, it, vi } from "vitest";
import { createCancelSubscriptionRepo } from "../../../../src/app/modules/admin/subscriptions/data/cancelSubscriptionRepo";

describe("cancel subscription REST contract", () => {
  it("deletes the subscription for the validated organization", async () => {
    const orgId = "11111111-1111-4111-8111-111111111111";
    const invoke = vi.fn().mockResolvedValue({ data: { ok: true, action: "canceled", orgId }, error: null });
    const repo = createCancelSubscriptionRepo({ functions: { invoke } });
    await expect(repo.cancelSubscription({ orgId })).resolves.toMatchObject({ ok: true, orgId });
    expect(invoke).toHaveBeenCalledWith(`subscriptions/${orgId}`, { method: "DELETE" });
  });

  it("rejects invalid organization ids before invoking", async () => {
    const invoke = vi.fn();
    const repo = createCancelSubscriptionRepo({ functions: { invoke } });
    await expect(repo.cancelSubscription({ orgId: "../another-org" })).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
