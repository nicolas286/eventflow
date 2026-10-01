import { z } from "zod";

const widgetColorSchema = z
  .string()
  .min(4, "Couleur trop courte")
  .max(20, "Couleur trop longue")
  .regex(/^#/, "La couleur doit commencer par #")
  .nullable()
  .optional();

export const organizationProfileSchema = z.object({
  orgId: z.uuid(),

  slug: z
    .string()
    .min(3, "Le slug est trop court")
    .max(150, "Le slug est trop long"),

  displayName: z
    .string()
    .min(3, "Le nom est trop court")
    .max(120, "Le nom est trop long"),

  description: z
    .string()
    .max(1000, "La description est trop longue")
    .nullable(),

  publicEmail: z.email("Email invalide").nullable(),

  phone: z
    .string()
    .min(3, "Le numéro de téléphone est trop court")
    .max(32, "Le numéro de téléphone est trop long")
    .nullable(),

  website: z
    .string()
    .min(5, "L'URL est trop courte")
    .max(2048, "L'URL est trop longue")
    .nullable(),

  logoUrl: z
    .string()
    .min(10, "L'URL du logo est trop courte")
    .max(2048, "L'URL du logo est trop longue")
    .nullable(),

  primaryColor: z
    .string()
    .min(4, "Couleur trop courte")
    .max(20, "Couleur trop longue")
    .regex(/^#/, "La couleur doit commencer par #")
    .nullable(),

  widgetBg: widgetColorSchema,
  widgetCard: widgetColorSchema,
  widgetText: widgetColorSchema,
  widgetButton: widgetColorSchema,

  createdAt: z.string(),
  updatedAt: z.string(),

  defaultEventBannerUrl: z
    .string()
    .min(10, "L'URL de la bannière est trop courte")
    .max(2048, "L'URL de la bannière est trop longue")
    .nullable(),

  emailReminderDaysBefore: z
    .number()
    .int()
    .min(0, "Le nombre de jours doit être positif")
    .nullable(),

  sellerLegalName: z.string().nullable().optional(),
  sellerAddress: z.string().nullable().optional(),
  sellerBusinessNumber: z.string().nullable().optional(),
  sellerType: z.enum(["professional", "non_professional"]).nullable().optional(),
  connectTermsAcceptedVersion: z.string().nullable().optional(),
  dpaAcceptedVersion: z.string().nullable().optional(),
  platformTermsAcceptedVersion: z.string().nullable().optional(),
  privacyAcceptedVersion: z.string().nullable().optional(),
  salesTerms: z.string().max(10_000).nullable().optional(),
  salesTermsVersion: z.string().nullable().optional(),
  salesTermsAcceptedVersion: z.string().nullable().optional(),
  salesTermsAcceptedAt: z.string().nullable().optional(),
  salesTermsAcceptedBy: z.uuid().nullable().optional(),
});

export type OrganizationProfile = z.infer<typeof organizationProfileSchema>;
