import { z } from "zod";
import { organizationSchema } from "./organization-data.ts";
import { organizationProfileSchema } from "./organization-data.ts";

export const publicOrganizationOverviewSchema = organizationSchema.pick({
  id: true,
  type: true,
  name: true,
});

export const publicOrganizationProfileSchema = organizationProfileSchema.pick({
  slug: true,
  displayName: true,
  description: true,
  publicEmail: true,
  phone: true,
  website: true,
  logoUrl: true,
  primaryColor: true,
  defaultEventBannerUrl: true,
}).strict();

export const publicOrgBySlugSchema = z.object({
  org: publicOrganizationOverviewSchema,
  profile: publicOrganizationProfileSchema,
}).strict();

export type PublicOrganizationOverview = z.infer<
  typeof publicOrganizationOverviewSchema
>;
export type PublicOrganizationProfile = z.infer<
  typeof publicOrganizationProfileSchema
>;
export type PublicOrgBySlug = z.infer<typeof publicOrgBySlugSchema>;
