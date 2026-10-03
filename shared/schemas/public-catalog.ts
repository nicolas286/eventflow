import { z } from "zod";
import { publicOrgProfileOverviewForEventPageSchema } from "./public-catalog-data.ts";
import { publicOrgEventsOverviewSchema } from "./public-events-overview-data.ts";
export * from "./public-catalog-data.ts";
export * from "./public-organization-data.ts";
export * from "./public-events-overview-data.ts";

const slug = z.string().trim().min(3).max(150);
export const publicOrgRequestSchema = z.object({ orgSlug: slug }).strict();
export const publicEventRequestSchema = publicOrgRequestSchema.extend({
  eventSlug: slug,
});
export const publicEventsPageRequestSchema = publicOrgRequestSchema.extend({
  limit: z.number().int().min(1).max(100).default(100),
  after: z.uuid().nullable().optional(),
});
export const publicEventsPageSchema = publicOrgEventsOverviewSchema.extend({
  events: publicOrgEventsOverviewSchema.shape.events.max(100),
  nextCursor: z.uuid().nullable(),
}).strict();
export const publicSalesTermsSchema = publicOrgProfileOverviewForEventPageSchema
  .pick({
    sellerLegalName: true,
    sellerAddress: true,
    sellerBusinessNumber: true,
    sellerType: true,
    displayName: true,
    publicEmail: true,
    phone: true,
    website: true,
    salesTerms: true,
    salesTermsVersion: true,
    salesTermsAccepted: true,
    paidSalesAvailable: true,
  }).extend({ salesTermsAvailable: z.boolean() }).strict();
export const publicEventShareSchema = z.object({
  orgName: z.string().max(120),
  orgDescription: z.string().max(1000).nullable(),
  eventTitle: z.string().max(120),
  eventDescription: z.string().max(5000).nullable(),
  bannerUrl: z.string().max(2048).nullable(),
}).strict();
