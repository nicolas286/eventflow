import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeEventsRepo } from "../../../src/app/modules/admin/events/data/makeEventsRepo";
import { makeEventDetailAdminCoreRepo } from "../../../src/app/modules/admin/singleEvent/data/makeEventDetailAdminCoreRepo";
import { createEventsRepo } from "../../../src/app/modules/admin/singleEvent/data/createEventRepo";
import { makeUpdateEventRepo } from "../../../src/app/modules/admin/singleEvent/data/updateEventRepo";
import { deleteEventRepo } from "../../../src/app/modules/admin/events/data/deleteEventRepo";
import { EdgeRequestError } from "../../../src/shared/errors/edgeRequestError";

const orgId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const event = {
  id: eventId, orgId, slug: "event-fixture", title: "Event fixture", isPublished: false,
  createdAt: "2026-10-01", updatedAt: "2026-10-03",
};
const detail = {
  event: {
    id: eventId, slug: "event-fixture", title: "Event fixture", isPublished: false,
    updatedAt: "2026-10-03", bannerUrlRaw: null, bannerUrlEffective: "https://example.invalid/banner.png",
  },
  orgBranding: { logoUrl: "https://example.invalid/logo.png", defaultEventBannerUrl: "https://example.invalid/banner.png" },
  products: [], formFieldsGroups: [],
  formFields: [{
    id: "33333333-3333-4333-8333-333333333333", eventId, label: "Option fixture", fieldKey: "custom_option",
    fieldType: "select", isRequired: false, options: [{ label: "snake_case", value: "legacy_value" }],
    sortOrder: 0, isActive: true, createdAt: "2026-10-01", updatedAt: "2026-10-03",
  }],
};
function fixture() {
  const supabase = createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const functions = supabase.functions;
  vi.spyOn(supabase, "functions", "get").mockReturnValue(functions);
  return {
    supabase, invoke: vi.spyOn(functions, "invoke"), rpc: vi.spyOn(supabase, "rpc"), from: vi.spyOn(supabase, "from"),
  };
}
describe("event repositories through the Edge API", () => {
  let client: ReturnType<typeof fixture>;
  beforeEach(() => { client = fixture(); });
  afterEach(() => {
    expect(client.rpc).not.toHaveBeenCalled(); expect(client.from).not.toHaveBeenCalled(); vi.restoreAllMocks();
  });

  it("loads organization overview from events/overview", async () => {
    const response = { orgId, events: [{ event, ordersCount: 2, paidCents: 500 }] };
    client.invoke.mockResolvedValue({ data: response, error: null });
    expect(await makeEventsRepo(client.supabase).getEventsOverview(orgId)).toEqual(response);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/overview", { body: { orgId } });
  });

  it("preserves UUID and organization/slug detail lookup and option JSON values", async () => {
    client.invoke.mockResolvedValue({ data: detail, error: null });
    const repo = makeEventDetailAdminCoreRepo(client.supabase);
    expect(await repo.getEventDetailAdminCore({ eventId })).toEqual(detail);
    expect(client.invoke).toHaveBeenLastCalledWith("events/detail", { body: { eventId } });
    expect(await repo.getEventDetailAdminCore({ orgId, eventSlug: "event-fixture" })).toEqual(detail);
    expect(client.invoke).toHaveBeenLastCalledWith("events/detail", { body: { orgId, eventSlug: "event-fixture" } });
  });

  it("creates events using camelCase and preserves zero limits and explicit null dates", async () => {
    client.invoke.mockResolvedValue({ data: event, error: null });
    const input = { orgId, title: "Event fixture", maxAttendees: 0, depositCents: 0, endsAt: null, charterText: "legacy_snake_case" };
    expect(await createEventsRepo(client.supabase).createEvent(input)).toEqual(event);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/create", { body: input });
  });

  it("updates the full event patch in a strict envelope", async () => {
    client.invoke.mockResolvedValue({ data: event, error: null });
    const input = { eventId, patch: { description: "Description", endsAt: null, maxAttendees: 0, isPublished: true } };
    expect(await makeUpdateEventRepo(client.supabase).updateEvent(input)).toEqual(event);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/update", { body: input });
  });

  it("duplicates an event with an optional trimmed title", async () => {
    client.invoke.mockResolvedValue({ data: event, error: null });
    const repo = createEventsRepo(client.supabase);
    await repo.duplicateEvent({ sourceEventId: eventId, title: " Copy fixture " });
    expect(client.invoke).toHaveBeenLastCalledWith("events/duplicate", { body: { sourceEventId: eventId, title: "Copy fixture" } });
    await repo.duplicateEvent({ sourceEventId: eventId });
    expect(client.invoke).toHaveBeenLastCalledWith("events/duplicate", { body: { sourceEventId: eventId } });
  });

  it("deletes events with the compatibility orgId hint and validates success", async () => {
    client.invoke.mockResolvedValue({ data: { success: true }, error: null });
    await expect(deleteEventRepo(client.supabase).deleteEvent({ eventId, orgId })).resolves.toBeUndefined();
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/delete", { body: { eventId, orgId } });
  });

  it("rejects forged server fields and attempts to move an event", async () => {
    const create = { orgId, title: "Event fixture", isPublished: true, slug: "forged" };
    await expect(createEventsRepo(client.supabase).createEvent(create)).rejects.toThrow();
    const patch = { eventId, patch: { title: "Event fixture", orgId } };
    await expect(makeUpdateEventRepo(client.supabase).updateEvent(patch)).rejects.toThrow();
    const duplicate = { sourceEventId: eventId, orgId };
    await expect(createEventsRepo(client.supabase).duplicateEvent(duplicate)).rejects.toThrow();
    const remove = { eventId, userId: orgId };
    await expect(deleteEventRepo(client.supabase).deleteEvent(remove)).rejects.toThrow();
    const lookup = { eventId, orgId, eventSlug: "event-fixture" };
    await expect(makeEventDetailAdminCoreRepo(client.supabase).getEventDetailAdminCore(lookup)).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("rejects empty patches and invalid event IDs", async () => {
    await expect(makeUpdateEventRepo(client.supabase).updateEvent({ eventId, patch: {} })).rejects.toThrow();
    await expect(makeEventDetailAdminCoreRepo(client.supabase).getEventDetailAdminCore({ eventId: "invalid" })).rejects.toThrow();
    await expect(makeEventsRepo(client.supabase).getEventsOverview("invalid")).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it("trims input titles and rejects titles shorter than the database contract", async () => {
    client.invoke.mockResolvedValue({ data: event, error: null });
    await createEventsRepo(client.supabase).createEvent({ orgId, title: " Event fixture " });
    expect(client.invoke).toHaveBeenLastCalledWith("events/create", { body: { orgId, title: "Event fixture" } });
    client.invoke.mockClear();
    await expect(createEventsRepo(client.supabase).createEvent({ orgId, title: "   " })).rejects.toThrow();
    await expect(makeUpdateEventRepo(client.supabase).updateEvent({ eventId, patch: { title: " a " } })).rejects.toThrow();
    await expect(createEventsRepo(client.supabase).duplicateEvent({ sourceEventId: eventId, title: "ab" })).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it.each(["not-a-date", "2027-02-31T12:00:00Z", "2027-01-01T12:00:00", "2027-01-01", "2027-01-01T12:00:00+99:00"])(
    "rejects invalid or non-offset input date %s", async (startsAt) => {
      await expect(createEventsRepo(client.supabase).createEvent({ orgId, title: "Event fixture", startsAt })).rejects.toThrow();
      await expect(makeUpdateEventRepo(client.supabase).updateEvent({ eventId, patch: { startsAt } })).rejects.toThrow();
      expect(client.invoke).not.toHaveBeenCalled();
    },
  );

  it("accepts ISO dates with an offset but does not impose that format on SQL response dates", async () => {
    client.invoke.mockResolvedValue({ data: { ...event, startsAt: "2027-01-01 12:00:00+00" }, error: null });
    const input = { orgId, title: "Event fixture", startsAt: "2027-01-01T13:00:00+01:00" };
    expect((await createEventsRepo(client.supabase).createEvent(input)).startsAt).toBe("2027-01-01 12:00:00+00");
    expect(client.invoke).toHaveBeenLastCalledWith("events/create", { body: input });
  });

  it("rejects invalid date ordering and past creation dates", async () => {
    await expect(createEventsRepo(client.supabase).createEvent({
      orgId, title: "Event fixture", startsAt: "2027-01-02T12:00:00Z", endsAt: "2027-01-01T12:00:00Z",
    })).rejects.toThrow();
    await expect(createEventsRepo(client.supabase).createEvent({ orgId, title: "Event fixture", startsAt: "2000-01-01T12:00:00Z" })).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "NOT_AUTHENTICATED", "NOT_FOUND", "PLAN_LIMIT", "EVENT_HAS_ORDERS"])(
    "preserves controlled refusal %s", async (code) => {
      client.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: code }), { status: 403 }) } });
      await expect(deleteEventRepo(client.supabase).deleteEvent({ eventId })).rejects.toThrow(code);
    },
  );

  it.each([[429, "TOO_MANY_REQUESTS"], [503, "RATE_LIMIT_UNAVAILABLE"]])(
    "preserves quota error %s and Retry-After", async (status, code) => {
      client.invoke.mockResolvedValue({ data: null, error: { context: new Response(JSON.stringify({ error: code }), { status, headers: { "Retry-After": "7" } }) } });
      const promise = makeEventsRepo(client.supabase).getEventsOverview(orgId);
      await expect(promise).rejects.toBeInstanceOf(EdgeRequestError);
      await expect(promise).rejects.toMatchObject({ status, message: code, retryAfterSeconds: 7 });
    },
  );

  it("rejects malformed DTOs and mutation acknowledgements", async () => {
    client.invoke.mockResolvedValue({ data: { success: false }, error: null });
    await expect(deleteEventRepo(client.supabase).deleteEvent({ eventId })).rejects.toThrow();
    await expect(createEventsRepo(client.supabase).createEvent({ orgId, title: "Event fixture" })).rejects.toThrow();
    await expect(makeEventDetailAdminCoreRepo(client.supabase).getEventDetailAdminCore({ eventId })).rejects.toThrow();
  });
});
