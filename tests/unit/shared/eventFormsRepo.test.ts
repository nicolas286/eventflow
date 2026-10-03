import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEventFormFieldRepo } from "../../../src/app/modules/admin/forms/data/createEventFormFieldRepo";
import { updateEventFormFieldRepo } from "../../../src/app/modules/admin/forms/data/updateEventFormFieldRepo";
import { deleteEventFormFieldRepo } from "../../../src/app/modules/admin/forms/data/deleteEventFormFieldRepo";
import { createEventFormFieldGroupRepo } from "../../../src/app/modules/admin/forms/data/createEventFormFieldGroupRepo";
import { updateEventFormFieldGroupRepo } from "../../../src/app/modules/admin/forms/data/updateEventFormFieldGroupRepo";
import { deleteEventFormFieldGroupRepo } from "../../../src/app/modules/admin/forms/data/deleteEventFormFieldGroupRepo";
import { reorderEventFormRepo } from "../../../src/app/modules/admin/forms/data/reorderEventFormRepo";
import { EdgeRequestError } from "../../../src/shared/errors/edgeRequestError";

const eventId = "11111111-1111-4111-8111-111111111111";
const fieldId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";
const fieldInput = {
  eventId, label: "Choice", fieldKey: "meal_choice", fieldType: "select" as const,
  options: [{ label: " Morning choice ", value: " morning_choice " }],
  isRequired: false, isActive: true, sortOrder: 0, groupId: null,
};
const field = { ...fieldInput, id: fieldId, createdAt: "2026-10-01", updatedAt: "2026-10-03" };
const groupInput = { eventId, label: "Guest", description: null, isActive: true, sortOrder: 0 };
const group = { ...groupInput, id: groupId, createdAt: "2026-10-01", updatedAt: "2026-10-03" };
function fixture() {
  const supabase = createClient("https://fixture.example.invalid", "fixture-public-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const functions = supabase.functions;
  vi.spyOn(supabase, "functions", "get").mockReturnValue(functions);
  return { supabase, invoke: vi.spyOn(functions, "invoke"), rpc: vi.spyOn(supabase, "rpc"), from: vi.spyOn(supabase, "from") };
}
describe("event forms repositories through the Edge API", () => {
  let client: ReturnType<typeof fixture>;
  beforeEach(() => { client = fixture(); });
  afterEach(() => {
    expect(client.rpc).not.toHaveBeenCalled(); expect(client.from).not.toHaveBeenCalled(); vi.restoreAllMocks();
  });

  it("creates a field with exact legacy JSON and no deep conversion", async () => {
    client.invoke.mockResolvedValue({ data: field, error: null });
    const result = await createEventFormFieldRepo(client.supabase).createEventFormField({ ...fieldInput, label: " Choice ", fieldKey: " meal_choice " });
    expect(result).toEqual(field);
    expect(result.options).toEqual(fieldInput.options);
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/forms/fields/create", { body: fieldInput });
  });

  it("creates groups and preserves description values", async () => {
    client.invoke.mockResolvedValue({ data: { ...group, description: " raw_description " }, error: null });
    await createEventFormFieldGroupRepo(client.supabase).createEventFormFieldGroup({ ...groupInput, label: " Guest ", description: " raw_description " });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/forms/groups/create", { body: { ...groupInput, description: " raw_description " } });
  });

  it("updates only submitted field values including exact option strings and explicit nulls", async () => {
    client.invoke.mockResolvedValue({ data: field, error: null });
    const options = [" snake_key "];
    await updateEventFormFieldRepo(client.supabase).updateEventFormField({ fieldId, patch: { options, groupId: null, label: undefined } });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/forms/fields/update", { body: { fieldId, patch: { options, groupId: null } } });
  });

  it("updates group business fields while preserving omitted values", async () => {
    client.invoke.mockResolvedValue({ data: group, error: null });
    await updateEventFormFieldGroupRepo(client.supabase).updateEventFormFieldGroup({ groupId, patch: { label: " Guest ", description: null, isActive: false } });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/forms/groups/update", { body: { groupId, patch: { label: "Guest", description: null, isActive: false } } });
  });

  it.each([{}, { label: undefined }])("keeps legacy empty update reads on static read routes for both resources", async (patch) => {
    client.invoke.mockResolvedValueOnce({ data: field, error: null }).mockResolvedValueOnce({ data: group, error: null });
    expect(await updateEventFormFieldRepo(client.supabase).updateEventFormField({ fieldId, patch })).toEqual(field);
    expect(await updateEventFormFieldGroupRepo(client.supabase).updateEventFormFieldGroup({ groupId, patch })).toEqual(group);
    expect(client.invoke).toHaveBeenNthCalledWith(1, "events/forms/fields/read", { body: { fieldId } });
    expect(client.invoke).toHaveBeenNthCalledWith(2, "events/forms/groups/read", { body: { groupId } });
  });

  it("deletes both resource types with strict acknowledgements", async () => {
    client.invoke.mockResolvedValue({ data: { success: true }, error: null });
    await expect(deleteEventFormFieldRepo(client.supabase).deleteEventFormField({ id: fieldId })).resolves.toBeUndefined();
    await expect(deleteEventFormFieldGroupRepo(client.supabase).deleteEventFormFieldGroup({ id: groupId })).resolves.toBeUndefined();
    expect(client.invoke).toHaveBeenNthCalledWith(1, "events/forms/fields/delete", { body: { id: fieldId } });
    expect(client.invoke).toHaveBeenNthCalledWith(2, "events/forms/groups/delete", { body: { id: groupId } });
  });

  it("sends both halves of a reorder as one Edge request", async () => {
    client.invoke.mockResolvedValue({ data: { success: true }, error: null });
    const fields = [{ id: fieldId, sortOrder: 1 }, { id: groupId, sortOrder: 0 }];
    await reorderEventFormRepo(client.supabase).reorderEventForm({ eventId, fields });
    expect(client.invoke).toHaveBeenCalledExactlyOnceWith("events/forms/reorder", { body: { eventId, fields, groups: [] } });
  });

  it.each([{ id: fieldId }, { eventId }, { createdAt: "2026-10-03" }, { updatedAt: "2026-10-03" }, { orgId: eventId }])(
    "rejects assigned patch system fields %j before any request", async (forged) => {
      await expect(updateEventFormFieldRepo(client.supabase).updateEventFormField({ fieldId, patch: { label: "Choice", ...forged } })).rejects.toThrow();
      await expect(updateEventFormFieldGroupRepo(client.supabase).updateEventFormFieldGroup({ groupId, patch: { label: "Guest", ...forged } })).rejects.toThrow();
      expect(client.invoke).not.toHaveBeenCalled();
    },
  );

  it("rejects malformed create/delete/reorder inputs and nested forged options", async () => {
    await expect(createEventFormFieldRepo(client.supabase).createEventFormField({ ...fieldInput, options: [{ label: "Valid", value: "snake_key", other: true }] })).rejects.toThrow();
    const forgedCreate = { ...groupInput, id: groupId };
    const forgedDelete = { id: groupId, eventId };
    const forgedReorder = { eventId, fields: [{ id: fieldId, sortOrder: 0, eventId }] };
    await expect(createEventFormFieldGroupRepo(client.supabase).createEventFormFieldGroup(forgedCreate)).rejects.toThrow();
    await expect(deleteEventFormFieldGroupRepo(client.supabase).deleteEventFormFieldGroup(forgedDelete)).rejects.toThrow();
    await expect(reorderEventFormRepo(client.supabase).reorderEventForm(forgedReorder)).rejects.toThrow();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it.each(["FORBIDDEN", "NOT_FOUND", "RESOURCE_IN_USE", "DUPLICATE_FIELD_KEY", "PLAN_LIMIT", "CONFLICT"])(
    "preserves business error %s", async (code) => {
      client.invoke.mockResolvedValue({ data: null, error: { context: Response.json({ error: code }, { status: 409 }) } });
      await expect(deleteEventFormFieldRepo(client.supabase).deleteEventFormField({ id: fieldId })).rejects.toThrow(code);
    },
  );

  it.each([[429, "TOO_MANY_REQUESTS"], [503, "RATE_LIMIT_UNAVAILABLE"]])("preserves quota status %s", async (status, code) => {
    client.invoke.mockResolvedValue({ data: null, error: { context: Response.json({ error: code }, { status, headers: { "Retry-After": "7" } }) } });
    const pending = reorderEventFormRepo(client.supabase).reorderEventForm({ eventId, groups: [{ id: groupId, sortOrder: 0 }] });
    await expect(pending).rejects.toBeInstanceOf(EdgeRequestError);
    await expect(pending).rejects.toMatchObject({ status, message: code, retryAfterSeconds: 7 });
  });

  it("rejects invalid DTOs and false mutation acknowledgements", async () => {
    client.invoke.mockResolvedValue({ data: { success: false }, error: null });
    await expect(reorderEventFormRepo(client.supabase).reorderEventForm({ eventId, fields: [{ id: fieldId, sortOrder: 0 }] })).rejects.toThrow();
    await expect(deleteEventFormFieldRepo(client.supabase).deleteEventFormField({ id: fieldId })).rejects.toThrow();
    await expect(updateEventFormFieldGroupRepo(client.supabase).updateEventFormFieldGroup({ groupId, patch: {} })).rejects.toThrow();
    await expect(createEventFormFieldRepo(client.supabase).createEventFormField(fieldInput)).rejects.toThrow();
  });
});
