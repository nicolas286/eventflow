import { z } from "zod";
import { eventDbSchema } from "./event-data.ts";

export const publicEventOverviewSchema = eventDbSchema
  .pick({
    id: true,
    slug: true,
    title: true,
    location: true,
    bannerUrl: true,
    startsAt: true,
    endsAt: true,
    registrationDeadline: true,
  })
  .extend({
    isSoldOut: z.boolean().default(false),
    isRegistrationOpen: z.boolean().default(true),
  });

export const publicOrgEventsOverviewSchema = z.object({
  orgSlug: z
    .string()
    .min(3, "Le slug est trop court")
    .max(150, "Le slug est trop long"),

  events: z.array(publicEventOverviewSchema),
});

export type PublicEventOverview = z.infer<typeof publicEventOverviewSchema>;
export type PublicOrgEventsOverview = z.infer<
  typeof publicOrgEventsOverviewSchema
>;
