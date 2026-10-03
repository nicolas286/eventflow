import { z } from "zod";
import { organizationSchema } from "@shared/models/db/db.organization.schema";
import { organizationProfileSchema } from "@shared/models/db/db.organizationProfile.schema";

const orgIdSchema = z.object({
  orgId: organizationProfileSchema.shape.orgId,
});

const orgPatchSchema = organizationSchema
  .pick({
    type: true,
    name: true,
    status: true,
  })
  .extend({
    name: organizationSchema.shape.name.trim(),
  })
  .partial();


const orgPatchSchemaNoTrial = orgPatchSchema.extend({
  status: z.enum(["active", "suspended"]).optional(),
});

const profilePatchSchema = organizationProfileSchema
  .pick({
    description: true,
    publicEmail: true,
    phone: true,
    website: true,
    emailReminderDaysBefore: true,
  })
  .partial();

export const updateOrgInfoPatchSchema = orgIdSchema
  .merge(orgPatchSchemaNoTrial)
  .merge(profilePatchSchema)
  .superRefine((val, ctx) => {
    const keys = Object.keys(val).filter((k) => k !== "orgId");
    if (keys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Aucun champ à modifier",
        path: [],
      });
    }
  });

  export const updateOrgInfoResultSchema = z.object({
  orgId: organizationSchema.shape.id,
  type: organizationSchema.shape.type,
  name: organizationSchema.shape.name,
  status: organizationSchema.shape.status,
  paymentStatus: organizationSchema.shape.paymentsStatus,
  paymentsLiveReady: organizationSchema.shape.paymentsLiveReady,

  profile: z.object({
    slug: organizationProfileSchema.shape.slug,
    displayName: organizationProfileSchema.shape.displayName,
    description: organizationProfileSchema.shape.description,
    publicEmail: organizationProfileSchema.shape.publicEmail,
    phone: organizationProfileSchema.shape.phone,
    website: organizationProfileSchema.shape.website,
    emailReminderDaysBefore: organizationProfileSchema.shape.emailReminderDaysBefore,
  }),
});

export type UpdateOrgInfoResult = z.infer<typeof updateOrgInfoResultSchema>;
export type UpdateOrgInfoPatch = z.infer<typeof updateOrgInfoPatchSchema>;
