import { z } from "zod";

const iso2CountryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Le code pays doit être en ISO-2 (ex: BE, FR)");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "L'email est trop long")
  .regex(/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i, "Email invalide");

const nonEmptyTrimmed = (
  min: number,
  max: number,
  msgEmpty: string,
  msgTooLong: string,
) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length >= min, msgEmpty)
    .refine((s) => s.length <= max, msgTooLong);

const optionalTrimmed = (max: number, msgTooLong: string) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= max, msgTooLong)
    .optional()
    .nullable();

const vatNumberSchema = z
  .string()
  .transform((s) => s.trim().replace(/\s+/g, "").toUpperCase())
  .refine((s) => s.length >= 6, "Le numéro de TVA est trop court")
  .refine((s) => s.length <= 20, "Le numéro de TVA est trop long");

export const organizationBillingSchema = z.object({
  orgId: z.uuid(),

  legalName: nonEmptyTrimmed(
    2,
    160,
    "La raison sociale est requise",
    "La raison sociale est trop longue",
  ),

  vatCountryCode: iso2CountryCodeSchema.optional().nullable(),
  vatNumber: vatNumberSchema.optional().nullable(),

  addressLine1: nonEmptyTrimmed(
    2,
    200,
    "L'adresse est requise",
    "L'adresse est trop longue",
  ),
  addressLine2: optionalTrimmed(200, "Le complément d'adresse est trop long"),

  postalCode: nonEmptyTrimmed(
    2,
    20,
    "Le code postal est requis",
    "Le code postal est trop long",
  ),
  city: nonEmptyTrimmed(
    2,
    120,
    "La ville est requise",
    "La ville est trop longue",
  ),
  countryCode: iso2CountryCodeSchema,

  billingEmail: emailSchema.optional().nullable(),
  invoiceReference: z
    .string().max(64, "La référence facture est trop longue")
    .transform((s) => s.trim())
    .optional()
    .nullable(),

  // présents dans la DB / RPC mais pas modifiables par le front (front-safe upsert)
  isVatValidated: z.boolean(),
  vatValidatedAt: z.string().optional().nullable(),
  vatValidationSource: z.string().max(
    200,
    "La source de validation est trop longue",
  ).optional().nullable(),

  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Patch input schema pour rpc_upsert_organization_billing (front-safe)
 * - Tous les champs modifiables sont optionnels (patch)
 * - On interdit explicitement les flags de validation TVA côté front
 */
export const organizationBillingPatchSchema = z
  .object({
    orgId: z.uuid(),

    legalName: z
      .string()
      .trim()
      .min(3, "La raison sociale est trop courte")
      .max(160, "La raison sociale est trop longue")
      .optional(),

    vatCountryCode: iso2CountryCodeSchema.optional().nullable(),
    vatNumber: vatNumberSchema.optional().nullable(),

    addressLine1: z
      .string()
      .trim()
      .min(2, "L'adresse est trop courte")
      .max(200, "L'adresse est trop longue")
      .optional(),

    addressLine2: z
      .string()
      .max(200, "Le complément d'adresse est trop long")
      .transform((s) => s.trim())
      .optional()
      .nullable(),

    postalCode: z
      .string()
      .trim()
      .min(2, "Le code postal est trop court")
      .max(20, "Le code postal est trop long")
      .optional(),

    city: z
      .string()
      .trim()
      .min(2, "La ville est trop courte")
      .max(120, "La ville est trop longue")
      .optional(),

    countryCode: iso2CountryCodeSchema.optional(),

    billingEmail: emailSchema.optional().nullable(),

    invoiceReference: z
      .string().max(64, "La référence facture est trop longue")
      .transform((s) => s.trim())
      .optional()
      .nullable(),

    // champs interdits côté front (même si l'utilisateur essaye de les envoyer)
    isVatValidated: z.never().optional(),
    vatValidatedAt: z.never().optional(),
    vatValidationSource: z.never().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    // 1) au moins un champ à patcher
    const hasAny = Object.entries(val).some(([key, value]) =>
      key !== "orgId" && value !== undefined
    );
    if (!hasAny) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Aucun champ à mettre à jour",
        path: [],
      });
    }

    // 2) cohérence TVA : si les deux sont présents dans le patch, ils doivent être cohérents
    const hasVatCountry = Object.prototype.hasOwnProperty.call(
      val,
      "vatCountryCode",
    );
    const hasVatNumber = Object.prototype.hasOwnProperty.call(val, "vatNumber");

    if (hasVatCountry && hasVatNumber) {
      const c = val.vatCountryCode ?? null;
      const n = val.vatNumber ?? null;
      if (c && !n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Le numéro de TVA est requis si le pays TVA est renseigné",
          path: ["vatNumber"],
        });
      }
      if (n && !c) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Le pays TVA est requis si le numéro de TVA est renseigné",
          path: ["vatCountryCode"],
        });
      }
    }
  });

/** Version UI: on cache les champs internes TVA */
export const organizationBillingUISchema = organizationBillingSchema.omit({
  isVatValidated: true,
  vatValidatedAt: true,
  vatValidationSource: true,
});

export const organizationBillingEnvelopeSchema = z
  .object({
    billing: organizationBillingUISchema.nullable(),
  })
  .loose(); // si la RPC renvoie aussi orgId / autre champ, on s'en fout

export type OrganizationBilling = z.infer<typeof organizationBillingSchema>;
export type OrganizationBillingUI = z.infer<typeof organizationBillingUISchema>;
export type OrganizationBillingPatch = z.infer<
  typeof organizationBillingPatchSchema
>;

export const billingRequestSchema = z.object({ orgId: z.uuid() }).strict();
export const billingReadResponseSchema = z.object({
  billing: organizationBillingSchema.nullable(),
}).strict();
