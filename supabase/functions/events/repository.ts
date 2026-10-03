import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  eventDetailAdminCoreSchema,
  eventOverviewEventSchema,
  eventSchema,
  eventsOverviewSchema,
  mutationSuccessSchema,
} from "../../../shared/schemas/events.ts";
import { eventProductSchema } from "../../../shared/schemas/event-products-data.ts";
import {
  eventFormFieldGroupSchema,
  eventFormFieldSchema,
} from "../../../shared/schemas/event-form-fields-data.ts";
import {
  dtoRow,
  throwOrganizerDatabaseError,
} from "../_shared/organizer-dto.ts";
import { internal, notFound } from "../_shared/errors.ts";

const eventReferenceSchema = z.object({ id: z.uuid(), org_id: z.uuid() });
const coreTransportSchema = z.object({
  event: z.unknown(),
  orgBranding: z.unknown(),
  products: z.array(z.unknown()),
  formFields: z.array(z.unknown()),
  formFieldsGroups: z.array(z.unknown()),
});
const overviewTransportSchema = z.object({
  orgId: z.uuid(),
  events: z.array(z.object({
    event: z.unknown(),
    ordersCount: z.number().int().nonnegative(),
    paidCents: z.number().int().nonnegative(),
  })),
});

export function createEventsRepository(client: SupabaseClient) {
  async function transaction(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const { data, error } = await client.rpc(name, args);
    if (error) throwOrganizerDatabaseError(error);
    return data;
  }
  return {
    async findEvent(
      input: { eventId: string } | { orgId: string; eventSlug: string },
    ) {
      let query = client.from("events").select("id,org_id");
      query = "eventId" in input
        ? query.eq("id", input.eventId)
        : query.eq("org_id", input.orgId).eq("slug", input.eventSlug);
      const { data, error } = await query.maybeSingle();
      if (error) throw internal("EVENT_LOAD_FAILED");
      if (!data) throw notFound("NOT_FOUND");
      const row = eventReferenceSchema.parse(data);
      return { eventId: row.id, orgId: row.org_id };
    },
    async overview(orgId: string) {
      const raw = overviewTransportSchema.parse(
        await transaction("organizer_get_events_overview", { p_org_id: orgId }),
      );
      return eventsOverviewSchema.parse({
        orgId: raw.orgId,
        events: raw.events.map((row) => ({
          ...row,
          event: dtoRow(eventOverviewEventSchema, row.event),
        })),
      });
    },
    async detail(orgId: string, eventId: string) {
      const raw = coreTransportSchema.parse(
        await transaction("organizer_get_event_detail_admin_core", {
          p_org_id: orgId,
          p_event_id: eventId,
          p_event_slug: null,
        }),
      );
      return eventDetailAdminCoreSchema.parse({
        event: raw.event,
        orgBranding: raw.orgBranding,
        products: raw.products.map((row) => dtoRow(eventProductSchema, row)),
        formFields: raw.formFields.map((row) =>
          dtoRow(eventFormFieldSchema, row)
        ),
        formFieldsGroups: raw.formFieldsGroups.map((row) =>
          dtoRow(eventFormFieldGroupSchema, row)
        ),
      });
    },
    async mutate(
      name:
        | "organizer_create_event"
        | "organizer_update_event"
        | "organizer_duplicate_event",
      actorId: string,
      input: Record<string, unknown>,
    ) {
      return eventSchema.parse(
        await transaction(name, { p_actor_id: actorId, p_input: input }),
      );
    },
    async remove(actorId: string, orgId: string, eventId: string) {
      mutationSuccessSchema.parse(
        await transaction("organizer_delete_event", {
          p_actor_id: actorId,
          p_org_id: orgId,
          p_event_id: eventId,
        }),
      );
    },
  };
}
