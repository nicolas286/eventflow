import { useMemo } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEventFormFieldRepo } from "../data/createEventFormFieldRepo";
import type { CreateEventFormFieldInput, EventFormField } from "@contracts/event-forms";
import { useScopedEventMutation } from "../../singleEvent/hooks/useScopedEventMutation";
import { normalizeError } from "@errors/errors";

export function useCreateEventFormField(params: { supabase: SupabaseClient; orgId?: string; eventId?: string }) {
  const repo = useMemo(() => createEventFormFieldRepo(params.supabase), [params.supabase]);
  const operation = useMemo(() => (input: CreateEventFormFieldInput) => repo.createEventFormField(input), [repo]);
  const { result, mutate, ...state } = useScopedEventMutation(operation, params, "Impossible de créer le champ de formulaire.", true);
  async function createEventFormField(input: CreateEventFormFieldInput): Promise<{ ok: true; data: EventFormField } | { ok: false; error: string }> {
    try {
      const data = await mutate(input);
      return data ? { ok: true, data } : { ok: false, error: "La demande a été interrompue." };
    } catch (error: unknown) {
      return { ok: false, error: normalizeError(error, "Impossible de créer le champ de formulaire.").message };
    }
  }
  return { ...state, created: result, createEventFormField };
}
