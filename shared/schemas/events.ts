import { z } from "zod";
import { eventDbSchema, validateEventDateConsistency } from "./event-data.ts";
import { eventProductsSchema } from "./event-products-data.ts";
import { eventFormFieldSchema, eventFormFieldGroupSchema } from "./event-form-fields-data.ts";
export { eventSchema, eventDbSchema, type Event } from "./event-data.ts";
export const eventOverviewEventSchema = eventDbSchema
  .omit({
    description: true,
    bannerUrl: true,
    depositCents: true,
  })
  .superRefine(validateEventDateConsistency);

export const eventOverviewRowSchema = z.object({
  event: eventOverviewEventSchema,
  ordersCount: z.number().int().min(0),
  paidCents: z.number().int().min(0),
});

export const eventOverviewRowsSchema = z.array(eventOverviewRowSchema);

export const eventsOverviewSchema = z.object({
  orgId: z.uuid(),
  events: eventOverviewRowsSchema,
});


export type EventOverviewEvent = z.infer<typeof eventOverviewEventSchema>;
export type EventOverviewRow = z.infer<typeof eventOverviewRowSchema>;
export type EventOverviewRows = z.infer<typeof eventOverviewRowsSchema>;
export type EventsOverview = z.infer<typeof eventsOverviewSchema>;

const eventDateInputSchema = z.iso.datetime({ offset: true })
  .refine((value) => Number.isFinite(Date.parse(value)), "Date invalide")
  .nullable().optional();
const eventTitleInputSchema = z.string().trim()
  .min(3, "Le titre est trop court")
  .max(120, "Le titre est trop long");

function validateEventDatesNotInPast(
  data: {
    startsAt?: string | null;
    endsAt?: string | null;
  },
  ctx: z.RefinementCtx
) {
  const now = Date.now();

  if (typeof data.startsAt === "string") {
    const start = Date.parse(data.startsAt);

    if (Number.isFinite(start) && start < now) {
      ctx.addIssue({
        code: "custom",
        path: ["startsAt"],
        message: "La date de début ne peut pas être dans le passé",
      });
    }
  }

  if (typeof data.endsAt === "string") {
    const end = Date.parse(data.endsAt);

    if (Number.isFinite(end) && end < now) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "La date de fin ne peut pas être dans le passé",
      });
    }
  }
}

export const createEventInputSchema = eventDbSchema
  .omit({
    id: true,
    slug: true,
    isPublished: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    title: eventTitleInputSchema,
    startsAt: eventDateInputSchema,
    endsAt: eventDateInputSchema,
    registrationDeadline: eventDateInputSchema,
  })
  .strict()
  .superRefine(validateEventDateConsistency)
  .superRefine(validateEventDatesNotInPast);

export type CreateEventInput = z.infer<typeof createEventInputSchema>;
export const updateEventPatchSchema = eventDbSchema
  .pick({
    title: true,
    location: true,
    startsAt: true,
    isPublished: true,
  })
  .extend({ title: eventTitleInputSchema, startsAt: eventDateInputSchema })
  .partial().strict();

export type UpdateEventPatch = z.infer<typeof updateEventPatchSchema>;
export const updateEventFullPatchSchema = eventDbSchema
  .pick({
    title: true,
    description: true,
    charterText: true,
    location: true,
    bannerUrl: true,
    startsAt: true,
    endsAt: true,
    registrationDeadline: true,
    maxAttendees: true,
    isPublished: true,
    depositCents: true,
  })
  .extend({
    title: eventTitleInputSchema,
    startsAt: eventDateInputSchema,
    endsAt: eventDateInputSchema,
    registrationDeadline: eventDateInputSchema,
  })
  .partial()
  .strict()
  .superRefine(validateEventDateConsistency);

export type UpdateEventFullPatch = z.infer<typeof updateEventFullPatchSchema>;
export const duplicateEventInputSchema = z
  .object({
    sourceEventId: z.uuid(),
    title: eventTitleInputSchema.optional(),
  })
  .strict();

export type DuplicateEventInput = z.infer<typeof duplicateEventInputSchema>;
export const deleteEventInputSchema = z.object({
  eventId: z.uuid(),
  orgId: z.uuid().optional(),
}).strict();

export type DeleteEventInput = z.infer<typeof deleteEventInputSchema>;

export const eventsOverviewRequestSchema = z.object({ orgId: z.uuid() }).strict();
export const eventDetailRequestSchema = z.union([
  z.object({ eventId: z.uuid() }).strict(),
  z.object({ orgId: z.uuid(), eventSlug: z.string().min(1).max(150) }).strict(),
]);
export const updateEventRequestSchema = z.object({
  eventId: z.uuid(),
  patch: updateEventFullPatchSchema.refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "Aucun champ à mettre à jour",
  ),
}).strict();
export const mutationSuccessSchema = z.object({ success: z.literal(true) }).strict();

export const adminEventDetailEventSchema = eventDbSchema
  .omit({ bannerUrl: true, createdAt: true, orgId: true })
  .extend({
    bannerUrlRaw: z.string().nullable(),
    bannerUrlEffective: z.string().min(5).max(2048),
  });
export const adminEventDetailOrgBrandingSchema = z.object({
  logoUrl: z.string().min(5).max(2048),
  defaultEventBannerUrl: z.string().min(5).max(2048),
});
export const eventFormFieldsSchema = z.array(eventFormFieldSchema);
export const eventFormFieldGroupsSchema = z.array(eventFormFieldGroupSchema);
export const eventDetailAdminCoreSchema = z.object({
  event: adminEventDetailEventSchema,
  orgBranding: adminEventDetailOrgBrandingSchema,
  products: eventProductsSchema,
  formFields: eventFormFieldsSchema,
  formFieldsGroups: eventFormFieldGroupsSchema,
});
export type AdminEventDetailEvent = z.infer<typeof adminEventDetailEventSchema>;
export type EventDetailAdminCore = z.infer<typeof eventDetailAdminCoreSchema>;
