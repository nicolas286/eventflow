import type { SupabaseClient } from "@supabase/supabase-js";
import { edgeSafe } from "@gateways/supabase/supabaseEdgeSafe";

import {
  createEventInputSchema,
  type CreateEventInput,
} from "../../events/schemas/admin.createEvent.schema";

import { duplicateEventInputSchema,
  type DuplicateEventInput
 } from "../schemas/admin.duplicateEvent.schema";

import { eventSchema, type Event } from "@shared/models/db/db.event.schema";

export function createEventsRepo(supabase: SupabaseClient) {
  return {
    async createEvent(input: CreateEventInput): Promise<Event> {
      const body = createEventInputSchema.parse(input);

      const raw = await edgeSafe<unknown>(
        () => supabase.functions.invoke("events/create", { body })
      );

      return eventSchema.parse(raw);
    },

    async duplicateEvent(input: DuplicateEventInput): Promise<Event> {
      const body = duplicateEventInputSchema.parse(input);

      const raw = await edgeSafe<unknown>(
        () => supabase.functions.invoke("events/duplicate", { body })
      );

      return eventSchema.parse(raw);
    },
  };
}
