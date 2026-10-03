import { z } from "zod";

const optionLabelSchema = z
  .string()
  .refine((value) => value.trim().length >= 1, "Une option ne peut pas être vide.")
  .refine((value) => value.trim().length <= 80, "Une option ne peut pas dépasser 80 caractères.");

const optionValueSchema = z
  .string()
  .refine((value) => value.trim().length >= 1, "La valeur d'une option ne peut pas être vide.")
  .refine((value) => value.trim().length <= 80, "La valeur d'une option ne peut pas dépasser 80 caractères.");

export const formFieldOptionsSchema = z.union([
  z.array(optionLabelSchema).min(1).max(100),

  // legacy DB
  z.array(
    z.object({
      label: optionLabelSchema,
      value: optionValueSchema,
    }).strict()
  ).min(1).max(100),

  z.null(),
]);

export const eventFormFieldSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  groupId: z.uuid().nullable().optional(),
  label: z.string().min(2, "Le label est trop court").max(120, "Le label est trop long"),
  fieldKey: z
  .string()
  .min(2)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*$/),
  fieldType: z.enum([
    "text",
    "textarea",
    "email",
    "number",
    "select",
    "checkbox",
    "radio",
    "date",
    "country",
    "phone"
  ]),
  isRequired: z.boolean(),
  options: formFieldOptionsSchema.optional().nullable(),
  sortOrder: z.number().int().min(0, "L'ordre de tri doit être un entier positif").max(1000, "L'ordre de tri est trop grand"),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const eventFormFieldUISchema = eventFormFieldSchema.omit({
  eventId: true,
  createdAt: true,
  updatedAt: true,
});

export const eventFormFieldGroupSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  label: z.string().min(1, "Le titre du groupe est requis").max(100, "Le titre du groupe est trop long"),
  sortOrder: z
    .number()
    .int()
    .min(0, "L'ordre de tri doit être un entier positif")
    .max(10000, "L'ordre de tri est trop grand"),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  description: z.string().min(1, "La description du groupe est trop courte").max(300, "La description du groupe est trop longue").nullable().optional(),
});

export const eventFormFieldGroupUISchema = eventFormFieldGroupSchema.omit({
  eventId: true,
  createdAt: true,
  updatedAt: true,
});

export type EventFormFieldOptions = z.infer<typeof formFieldOptionsSchema>;
export type EventFormField = z.infer<typeof eventFormFieldSchema>;
export type EventFormFieldUI = z.infer<typeof eventFormFieldUISchema>;
export type EventFormFieldGroup = z.infer<typeof eventFormFieldGroupSchema>;
export type EventFormFieldGroupUI = z.infer<typeof eventFormFieldGroupUISchema>;
