import { z } from "zod";

export const eventProductSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string().min(2, "Le nom du produit est trop court").max(80, "Le nom du produit est trop long"),
  description: z.string().max(500, "La description du produit est trop longue").nullable().optional(),
  priceCents: z.number().int().min(0, "Le prix doit être positif ou nul").max(10000000, "Le prix est trop élevé"),
  currency: z.string().length(3, "Le code devise doit faire 3 caractères").optional(),
  stockQty: z
    .number()
    .min(0, "La quantité en stock doit être positive ou nulle.")
    .max(1000000, "Le stock ne peut pas dépasser 1 000 000.")
    .refine(Number.isInteger, {
      message: "La quantité en stock doit être un nombre entier.",
    })
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0, "L'ordre de tri doit être positif ou nul").max(1000, "L'ordre de tri est trop élevé").optional(),
  createsAttendees: z.boolean().optional(),
  attendeesPerUnit: z.number().int().min(1, "Le nombre de participants par unité doit être au moins 1").max(20, "Le nombre de participants par unité est trop élevé").optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  reservedQty: z.number().int().min(0, "La quantité réservée doit être positive ou nulle"),
  soldQty: z.number().int().min(0, "La quantité vendue doit être positive ou nulle"),
  isGatekeeper: z.boolean().optional(),
  closeEventWhenSoldOut: z.boolean().optional()
});

export const eventProductsSchema = z.array(eventProductSchema);

export type EventProduct = z.infer<typeof eventProductSchema>;
export type EventProducts = z.infer<typeof eventProductsSchema>;
