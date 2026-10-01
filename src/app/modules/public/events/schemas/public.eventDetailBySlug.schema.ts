import { z } from "zod";
import { eventProductSchema } from "@shared/models/db/db.eventProducts.schema";
import { eventDbSchema } from "@shared/models/db/db.event.schema";
import { organizationProfileSchema } from "@shared/models/db/db.organizationProfile.schema";
import {
  eventFormFieldGroupSchema,
  eventFormFieldSchema,
} from "@shared/models/db/db.eventFormFields.schema";

export const publicOrgProfileOverviewForEventPageSchema =
  organizationProfileSchema
    .pick({
      slug: true,
      defaultEventBannerUrl: true,
      logoUrl: true,
      displayName: true,
      publicEmail: true,
      phone: true,
      sellerLegalName: true,
      sellerAddress: true,
      sellerBusinessNumber: true,
      sellerType: true,
      website: true,
      primaryColor: true,
    })
    .extend({
      salesTerms: z.string().min(200).max(10_000),
      salesTermsVersion: z.string().min(3).max(100),
      salesTermsAccepted: z.boolean(),
      paidSalesAvailable: z.boolean().default(false),
    });

export const publicEventSchema = eventDbSchema
  .pick({
    id: true,
    slug: true,
    title: true,
    description: true,
    location: true,
    bannerUrl: true,
    startsAt: true,
    endsAt: true,
    registrationDeadline: true,
    depositCents: true,
    maxAttendees: true,
    charterText: true,
  })
  .extend({
    isSoldOut: z.boolean().default(false),
    isRegistrationOpen: z.boolean().default(true),
  });

export const publicEventProductSchema = eventProductSchema.pick({
  id: true,
  name: true,
  description: true,
  currency: true,
  priceCents: true,
  stockQty: true,
  reservedQty: true,
  soldQty: true,
  createsAttendees: true,
  attendeesPerUnit: true,
  sortOrder: true,
});

export const publicFormFieldSchema = eventFormFieldSchema.pick({
  id: true,
  label: true,
  fieldKey: true,
  fieldType: true,
  isRequired: true,
  options: true,
  sortOrder: true,
  groupId: true,
});

export const publicFormFieldsGroupSchema = eventFormFieldGroupSchema.pick({
  id: true,
  label: true,
  sortOrder: true,
  description: true,
});

export const publicEventDetailSchema = z.object({
  org: publicOrgProfileOverviewForEventPageSchema,
  event: publicEventSchema,
  products: z.array(publicEventProductSchema),
  formFields: z.array(publicFormFieldSchema),
  formFieldsGroups: z.array(publicFormFieldsGroupSchema),
});

export type PublicEventProduct = z.infer<typeof publicEventProductSchema>;
export type PublicEvent = z.infer<typeof publicEventSchema>;
export type PublicOrgProfileOverviewForEventPage = z.infer<
  typeof publicOrgProfileOverviewForEventPageSchema
>;
export type PublicFormField = z.infer<typeof publicFormFieldSchema>;
export type PublicEventDetail = z.infer<typeof publicEventDetailSchema>;
