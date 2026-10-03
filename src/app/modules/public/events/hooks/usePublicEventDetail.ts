import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makePublicEventDetailRepo } from "@app/modules/public/events/data/makePublicEventDetailRepo";
import type { PublicEventDetail } from "../schemas/public.eventDetailBySlug.schema";
import { normalizeError } from "@errors/errors";

type State = {
  loading: boolean;
  error: string | null;
  data: PublicEventDetail | null;
};

export function usePublicEventDetail(params: {
  supabase: SupabaseClient;
  orgSlug: string | null | undefined;
  eventSlug: string | null | undefined;
}) {
  const { supabase, orgSlug, eventSlug } = params;

  const repo = useMemo(() => makePublicEventDetailRepo(supabase), [supabase]);

  const requestScope = JSON.stringify([
    orgSlug?.trim() ?? null,
    eventSlug?.trim() ?? null,
  ]);
  const [state, setState] = useState<State & { scope: string }>({
    scope: requestScope,
    loading: true,
    error: null,
    data: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        if (!orgSlug || !eventSlug) {
          setState({
            scope: requestScope,
            loading: false,
            error: null,
            data: null,
          });
          return;
        }

        setState({
          scope: requestScope,
          data: null,
          loading: true,
          error: null,
        });

        const data = await repo.getPublicEventDetail(orgSlug, eventSlug);
        if (cancelled) return;

        setState({ scope: requestScope, loading: false, error: null, data });
      } catch (e: unknown) {
        if (cancelled) return;
        const ne = normalizeError(
          e,
          "Impossible de charger les détails de l’événement",
        );
        setState((s) => ({
          ...s,
          scope: requestScope,
          loading: false,
          error: ne.message,
        }));
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [repo, orgSlug, eventSlug, requestScope]);

  const { scope, ...current } = state;
  return scope === requestScope
    ? current
    : { loading: Boolean(orgSlug && eventSlug), error: null, data: null };
}
