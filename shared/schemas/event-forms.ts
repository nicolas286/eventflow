import { z } from "zod";
import { eventFormFieldSchema, eventFormFieldGroupSchema } from "./event-form-fields-data.ts";

export {
  eventFormFieldSchema, eventFormFieldGroupSchema, formFieldOptionsSchema,
  type EventFormField, type EventFormFieldGroup, type EventFormFieldOptions,
} from "./event-form-fields-data.ts";
export const mutationSuccessSchema = z.object({ success: z.literal(true) }).strict();

const fieldBusinessSchema = eventFormFieldSchema.omit({
  id: true, eventId: true, createdAt: true, updatedAt: true,
}).extend({
  label: z.string().trim().min(2, "Le label est trop court").max(120, "Le label est trop long"),
  fieldKey: z.string().trim().min(2).max(100).regex(/^[a-z][a-z0-9_]*$/),
}).strict();

function validateFieldOptions(
  data: { fieldType?: string; options?: z.infer<typeof eventFormFieldSchema.shape.options> },
  ctx: z.RefinementCtx,
) {
  // Updates that omit either value are validated against the stored field by the server.
  if (data.fieldType === undefined) return;
  const needsOptions = data.fieldType === "select" || data.fieldType === "radio";
  if (needsOptions && (!Array.isArray(data.options) || data.options.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "Au moins une option est requise." });
  } else if (!needsOptions && data.options != null) {
    ctx.addIssue({
      code: "custom", path: ["options"],
      message: "Les options ne sont autorisées que pour les champs select et radio.",
    });
  }
}

export const fieldCreateRequestSchema = fieldBusinessSchema.extend({ eventId: z.uuid() })
  .strict().superRefine(validateFieldOptions);
export const fieldUpdatePatchSchema = fieldBusinessSchema.partial().strict()
  .superRefine((data, ctx) => {
    if (data.options !== undefined) validateFieldOptions(data, ctx);
  });
export const fieldUpdateRequestSchema = z.object({
  fieldId: z.uuid(),
  patch: fieldUpdatePatchSchema.refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    "Aucun champ à mettre à jour",
  ),
}).strict();
export const fieldReadRequestSchema = z.object({ fieldId: z.uuid() }).strict();
export const fieldDeleteRequestSchema = z.object({ id: z.uuid() }).strict();

const groupBusinessSchema = eventFormFieldGroupSchema.omit({
  id: true, eventId: true, createdAt: true, updatedAt: true,
}).extend({
  label: z.string().trim().min(1, "Le titre du groupe est requis").max(100, "Le titre du groupe est trop long"),
}).strict();
export const groupCreateRequestSchema = groupBusinessSchema.extend({ eventId: z.uuid() }).strict();
export const groupUpdatePatchSchema = groupBusinessSchema.partial().strict();
export const groupUpdateRequestSchema = z.object({
  groupId: z.uuid(),
  patch: groupUpdatePatchSchema.refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    "Aucun champ à mettre à jour",
  ),
}).strict();
export const groupReadRequestSchema = z.object({ groupId: z.uuid() }).strict();
export const groupDeleteRequestSchema = z.object({ id: z.uuid() }).strict();

// Legacy frontend wrappers expose the row ID alongside their business patch.
export const updateEventFormFieldPatchSchema = fieldBusinessSchema.partial()
  .extend({ id: z.uuid() }).strict();
export const updateEventFormFieldGroupPatchSchema = groupUpdatePatchSchema
  .extend({ id: z.uuid() }).strict();

export const formReorderRequestSchema = z.object({
  eventId: z.uuid(),
  fields: z.array(z.object({
    id: z.uuid(), sortOrder: eventFormFieldSchema.shape.sortOrder,
  }).strict()).max(100).default([]),
  groups: z.array(z.object({
    id: z.uuid(), sortOrder: eventFormFieldGroupSchema.shape.sortOrder,
  }).strict()).max(100).default([]),
}).strict().superRefine((data, ctx) => {
  if (data.fields.length + data.groups.length === 0) {
    ctx.addIssue({ code: "custom", path: ["fields"], message: "Au moins un ordre est requis." });
  }
  for (const kind of ["fields", "groups"] as const) {
    const ids = new Set<string>();
    data[kind].forEach((entry, index) => {
      const id = entry.id.toLowerCase();
      if (ids.has(id)) {
        ctx.addIssue({ code: "custom", path: [kind, index, "id"], message: "Identifiant dupliqué." });
      }
      ids.add(id);
    });
  }
});

export type CreateEventFormFieldInput = z.input<typeof fieldCreateRequestSchema>;
export type UpdateEventFormFieldPatch = z.input<typeof updateEventFormFieldPatchSchema>;
export type DeleteEventFormFieldInput = z.input<typeof fieldDeleteRequestSchema>;
export type CreateEventFormFieldGroupInput = z.input<typeof groupCreateRequestSchema>;
export type UpdateEventFormFieldGroupPatch = z.input<typeof updateEventFormFieldGroupPatchSchema>;
export type DeleteEventFormFieldGroupInput = z.input<typeof groupDeleteRequestSchema>;
export type FormReorderInput = z.input<typeof formReorderRequestSchema>;
