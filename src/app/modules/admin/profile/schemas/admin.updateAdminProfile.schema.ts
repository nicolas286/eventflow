import { z } from "zod";
import { profileSchema } from "@shared/models/db/db.profile.schema";

export const adminProfileFormSchema = profileSchema
  .omit({
    createdAt: true,
    updatedAt: true,
    stripeConnectAllowed: true,
  })
  .extend({
    firstName: z.string().max(80).optional().nullable(),
    lastName: z.string().max(80).optional().nullable(),
    phone: z.string().max(32).optional().nullable(),
    addressLine1: z.string().max(120).optional().nullable(),
    addressLine2: z.string().max(120).optional().nullable(),
    postalCode: z.string().max(20).optional().nullable(),
    city: z.string().max(80).optional().nullable(),
    country: z.string().max(80).optional().nullable(),
    countryCode: z.string().length(2).optional().nullable(),
  });

export type AdminProfileForm = z.infer<typeof adminProfileFormSchema>;

export const adminProfilePatchSchema = profileSchema
  .omit({
    userId: true,
    createdAt: true,
    updatedAt: true,
    stripeConnectAllowed: true,
  })
  .partial()
  .strict();

export const updateAdminProfileInputSchema = z
  .object({
    userId: profileSchema.shape.userId,
    patch: adminProfilePatchSchema,
  })
  .strict();

export type UpdateAdminProfileInput = z.infer<
  typeof updateAdminProfileInputSchema
>;
export type AdminProfile = z.infer<typeof profileSchema>;
export type AdminProfilePatch = z.infer<typeof adminProfilePatchSchema>;
