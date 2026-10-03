import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { makeUpdateEventRepo } from "@app/modules/admin/singleEvent/data/updateEventRepo";
import type { Event } from "@shared/models/db/db.event.schema";
import type { UpdateEventFullPatch } from "../schemas/admin.updateEventFullPatch.schema";
import { useScopedEventMutation } from "./useScopedEventMutation";

export type UpdateEventInput<Patch extends Record<string, unknown>> = { eventId: string; patch: Patch };

export function useUpdateEvent(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => makeUpdateEventRepo(params.supabase), [params.supabase]);
  const update = useMemo(() => (input: UpdateEventInput<UpdateEventFullPatch>) => repo.updateEvent(input), [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(update, params, "Impossible d'enregistrer l'événement");
  async function updateEvent<Patch extends Record<string, unknown>>(input: UpdateEventInput<Patch>): Promise<Event | null> {
    return mutate(input);
  }
  return { ...state, updated: result, updateEvent };
}
