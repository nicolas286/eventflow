import { z } from "zod";

type EventDateLike = {
  startsAt?: string | null;
  endsAt?: string | null;
  registrationDeadline?: string | null;
};

export function validateEventDateConsistency(
  data: EventDateLike,
  ctx: z.RefinementCtx
) {
  if (typeof data.startsAt === "string" && typeof data.endsAt === "string") {
    const start = Date.parse(data.startsAt);
    const end = Date.parse(data.endsAt);

    if (Number.isFinite(start) && Number.isFinite(end) && end < start) {
      ctx.addIssue({
        code: "custom",
        path: ["endsAt"],
        message: "La date de fin doit être postérieure à la date de début",
      });
    }
  }

  if (
    typeof data.registrationDeadline === "string" &&
    typeof data.startsAt === "string"
  ) {
    const deadline = Date.parse(data.registrationDeadline);
    const start = Date.parse(data.startsAt);

    if (
      Number.isFinite(deadline) &&
      Number.isFinite(start) &&
      deadline > start
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["registrationDeadline"],
        message:
          "La date limite d’inscription doit être antérieure ou égale à la date de début",
      });
    }
  }
}

export const eventDbSchema = z.object({
  id: z.uuid(),
  orgId: z.uuid(),

  slug: z
    .string()
    .min(3, "Le slug est trop court")
    .max(150, "Le slug est trop long"),

  title: z
    .string()
    .min(3, "Le titre est trop court")
    .max(120, "Le titre est trop long"),

  description: z
    .string()
    .max(5000, "La description est trop longue")
    .nullable()
    .optional(),

  location: z
    .string()
    .max(180, "L'emplacement est trop long")
    .nullable()
    .optional(),

  bannerUrl: z
    .string()
    .min(10, "L'URL de la bannière est trop courte")
    .max(2048, "L'URL de la bannière est trop longue")
    .nullable()
    .optional(),

  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  registrationDeadline: z.string().nullable().optional(),

  isPublished: z.boolean(),

  maxAttendees: z
    .number()
    .int("Le nombre de participants maximal doit être un entier")
    .min(0, "Le nombre de participants maximal ne peut être négatif")
    .nullable()
    .optional(),

  createdAt: z.string(),
  updatedAt: z.string(),

  depositCents: z
    .number()
    .int()
    .min(0, "L'acompte doit être positif ou nul")
    .nullable()
    .optional(),

  charterText: z
    .string()
    .max(10000, "La charte est trop longue")
    .nullable()
    .optional(),
});

export const eventSchema = eventDbSchema.superRefine(validateEventDateConsistency);

export const eventsSchema = z.array(eventSchema);

export type EventDb = z.infer<typeof eventDbSchema>;
export type Event = z.infer<typeof eventSchema>;
export type Events = z.infer<typeof eventsSchema>;