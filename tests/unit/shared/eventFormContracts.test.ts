import { describe, expect, it } from "vitest";
import {
  fieldCreateRequestSchema, fieldUpdateRequestSchema, fieldUpdatePatchSchema,
  fieldReadRequestSchema, fieldDeleteRequestSchema, groupCreateRequestSchema,
  groupUpdateRequestSchema, groupUpdatePatchSchema, groupReadRequestSchema,
  groupDeleteRequestSchema, formReorderRequestSchema, mutationSuccessSchema,
  eventFormFieldSchema, formFieldOptionsSchema,
} from "../../../shared/schemas/event-forms";

const eventId = "11111111-1111-4111-8111-111111111111";
const fieldId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";
const field = {
  eventId, label: "Choice", fieldKey: "meal_choice", fieldType: "select",
  options: [" morning_choice ", "evening_choice"], isRequired: true, isActive: true, sortOrder: 0,
};
const group = { eventId, label: "Guest", sortOrder: 0, isActive: true };

describe("event form API contracts", () => {
  it.each([
    [" morning_choice ", " evening_choice "],
    [{ label: " Morning choice ", value: " morning_choice " }],
  ])("preserves legacy option JSON exactly while normalizing known input labels and keys", (first, second) => {
    const options = second === undefined ? [first] : [first, second];
    const parsed = fieldCreateRequestSchema.parse({
      ...field, label: " Choice ", fieldKey: " meal_choice ", options,
    });
    expect(parsed.label).toBe("Choice");
    expect(parsed.fieldKey).toBe("meal_choice");
    expect(parsed.options).toEqual(options);
    const dto = eventFormFieldSchema.parse({
      ...parsed, id: fieldId, label: " Choice ", createdAt: "2026-10-03", updatedAt: "2026-10-03",
    });
    expect(dto.options).toEqual(options);
    expect(dto.label).toBe(" Choice ");
  });

  it("keeps padded legacy options valid without stripping their whitespace", () => {
    const options = [`  ${"a".repeat(80)}  `];
    expect(formFieldOptionsSchema.parse(options)).toEqual(options);
    expect(formFieldOptionsSchema.safeParse([" "]).success).toBe(false);
    expect(formFieldOptionsSchema.safeParse(["a".repeat(81)]).success).toBe(false);
    expect(formFieldOptionsSchema.safeParse([{ label: "Valid", value: " " }]).success).toBe(false);
    expect(formFieldOptionsSchema.safeParse([{ label: "Valid", value: "a".repeat(81) }]).success).toBe(false);
    expect(formFieldOptionsSchema.safeParse([{ label: "Valid", value: "raw_key", selected: true }]).success).toBe(false);
  });

  it("enforces create type/options consistency", () => {
    for (const fieldType of ["select", "radio"]) {
      expect(fieldCreateRequestSchema.safeParse({ ...field, fieldType, options: null }).success).toBe(false);
      expect(fieldCreateRequestSchema.safeParse({ ...field, fieldType, options: undefined }).success).toBe(false);
      expect(fieldCreateRequestSchema.safeParse({ ...field, fieldType, options: [] }).success).toBe(false);
    }
    expect(fieldCreateRequestSchema.safeParse({ ...field, fieldType: "text" }).success).toBe(false);
    expect(fieldCreateRequestSchema.parse({ ...field, fieldType: "text", options: null }).options).toBeNull();
    expect(fieldCreateRequestSchema.parse({ ...field, fieldType: "text", options: undefined }).options).toBeUndefined();
  });

  it("checks complete update pairs and leaves partial type/options validation to the merged server row", () => {
    expect(fieldUpdateRequestSchema.parse({ fieldId, patch: { fieldType: "select" } }).patch).toEqual({ fieldType: "select" });
    expect(fieldUpdateRequestSchema.parse({ fieldId, patch: { options: [" raw_value "] } }).patch).toEqual({ options: [" raw_value "] });
    expect(fieldUpdateRequestSchema.parse({ fieldId, patch: { options: null, groupId: null } }).patch).toEqual({ options: null, groupId: null });
    expect(fieldUpdateRequestSchema.safeParse({ fieldId, patch: { fieldType: "radio", options: null } }).success).toBe(false);
    expect(fieldUpdateRequestSchema.safeParse({ fieldId, patch: { fieldType: "text", options: ["Choice"] } }).success).toBe(false);
    expect(fieldUpdateRequestSchema.parse({ fieldId, patch: { label: " Changed " } }).patch).toEqual({ label: "Changed" });
  });

  it("preserves group null descriptions and normalizes only its known input label", () => {
    expect(groupCreateRequestSchema.parse({ ...group, label: " Guest ", description: " raw_description " })).toEqual({
      ...group, description: " raw_description ",
    });
    expect(groupUpdateRequestSchema.parse({ groupId, patch: { description: null } }).patch).toEqual({ description: null });
    expect(groupCreateRequestSchema.safeParse({ ...group, label: " " }).success).toBe(false);
  });

  it.each([
    { id: fieldId }, { createdAt: "2026-10-03" }, { updatedAt: "2026-10-03" }, { orgId: eventId },
  ])("rejects assigned system fields %j", (forged) => {
    expect(fieldCreateRequestSchema.safeParse({ ...field, ...forged }).success).toBe(false);
    expect(groupCreateRequestSchema.safeParse({ ...group, ...forged }).success).toBe(false);
    expect(fieldUpdateRequestSchema.safeParse({ fieldId, patch: { label: "Choice", ...forged } }).success).toBe(false);
    expect(groupUpdateRequestSchema.safeParse({ groupId, patch: { label: "Guest", ...forged } }).success).toBe(false);
  });

  it("rejects event reassignment, empty update writes and ambiguous read/delete identities", () => {
    expect(fieldUpdateRequestSchema.safeParse({ fieldId, patch: { eventId } }).success).toBe(false);
    expect(groupUpdateRequestSchema.safeParse({ groupId, patch: { eventId } }).success).toBe(false);
    expect(fieldUpdatePatchSchema.parse({})).toEqual({});
    expect(groupUpdatePatchSchema.parse({})).toEqual({});
    expect(fieldUpdateRequestSchema.safeParse({ fieldId, patch: {} }).success).toBe(false);
    expect(groupUpdateRequestSchema.safeParse({ groupId, patch: { label: undefined } }).success).toBe(false);
    expect(fieldReadRequestSchema.safeParse({ fieldId, eventId }).success).toBe(false);
    expect(groupReadRequestSchema.safeParse({ groupId, eventId }).success).toBe(false);
    expect(fieldDeleteRequestSchema.safeParse({ id: fieldId, eventId }).success).toBe(false);
    expect(groupDeleteRequestSchema.safeParse({ id: groupId, eventId }).success).toBe(false);
    expect(fieldReadRequestSchema.parse({ fieldId })).toEqual({ fieldId });
    expect(groupReadRequestSchema.parse({ groupId })).toEqual({ groupId });
  });

  it("defaults absent reorder arrays while requiring at least one entry", () => {
    expect(formReorderRequestSchema.parse({ eventId, fields: [{ id: fieldId, sortOrder: 0 }] })).toEqual({
      eventId, fields: [{ id: fieldId, sortOrder: 0 }], groups: [],
    });
    expect(formReorderRequestSchema.parse({ eventId, groups: [{ id: groupId, sortOrder: 10000 }] })).toEqual({
      eventId, fields: [], groups: [{ id: groupId, sortOrder: 10000 }],
    });
    expect(formReorderRequestSchema.safeParse({ eventId }).success).toBe(false);
  });

  it.each([-1, 1.5, Infinity, NaN, 1001])("rejects invalid field reorder positions %s", (sortOrder) => {
    expect(formReorderRequestSchema.safeParse({ eventId, fields: [{ id: fieldId, sortOrder }] }).success).toBe(false);
  });

  it("rejects malformed, duplicated and excessive reorder entries", () => {
    const entry = { id: fieldId, sortOrder: 0 };
    expect(formReorderRequestSchema.safeParse({ eventId, fields: [entry, entry] }).success).toBe(false);
    const mixedCaseId = "abcdefab-cdef-4abc-8def-abcdefabcdef";
    expect(formReorderRequestSchema.safeParse({ eventId, fields: [
      { id: mixedCaseId, sortOrder: 0 }, { id: mixedCaseId.toUpperCase(), sortOrder: 1 },
    ] }).success).toBe(false);
    expect(formReorderRequestSchema.safeParse({ eventId, fields: [entry], groups: [entry] }).success).toBe(true);
    expect(formReorderRequestSchema.safeParse({ eventId, fields: [{ ...entry, groupId }] }).success).toBe(false);
    expect(formReorderRequestSchema.safeParse({ eventId, groups: [{ id: groupId, sortOrder: 10001 }] }).success).toBe(false);
    const entries = Array.from({ length: 101 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, sortOrder: i,
    }));
    expect(formReorderRequestSchema.safeParse({ eventId, fields: entries }).success).toBe(false);
    expect(formReorderRequestSchema.safeParse({ eventId, groups: entries }).success).toBe(false);
    expect(mutationSuccessSchema.safeParse({ success: true, data: {} }).success).toBe(false);
    expect(mutationSuccessSchema.safeParse({ success: false }).success).toBe(false);
  });
});
