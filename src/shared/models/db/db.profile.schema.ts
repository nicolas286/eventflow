import { z } from "zod";

export const profileSchema = z.object({
  userId: z.uuid(),
  firstName: z
    .string()
    .min(2, "Le prénom est trop court")
    .max(80, "Le prénom est trop long")
    .nullable()
    .optional(),
  lastName: z
    .string()
    .min(2, "Le nom est trop court")
    .max(80, "Le nom est trop long")
    .nullable()
    .optional(),
  phone: z
    .string()
    .min(3, "Le numéro de téléphone est trop court")
    .max(32, "Le numéro de téléphone est trop long")
    .nullable()
    .optional(),
  addressLine1: z
    .string()
    .min(3, "L'adresse est trop courte")
    .max(120, "L'adresse est trop longue")
    .nullable()
    .optional(),
  addressLine2: z
    .string()
    .min(3, "L'adresse est trop courte")
    .max(120, "L'adresse est trop longue")
    .nullable()
    .optional(),
  postalCode: z
    .string()
    .min(2, "Le code postal est trop court")
    .max(20, "Le code postal est trop long")
    .nullable()
    .optional(),
  city: z
    .string()
    .min(2, "La ville est trop courte")
    .max(80, "La ville est trop longue")
    .nullable()
    .optional(),
  country: z
    .string()
    .min(2, "Le pays est trop court")
    .max(80, "Le pays est trop long")
    .nullable()
    .optional(),
  countryCode: z
    .string()
    .length(2, "Le code pays doit contenir 2 lettres")
    .nullable()
    .optional(),
  stripeConnectAllowed: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Profile = z.infer<typeof profileSchema>;
