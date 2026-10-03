import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { makePublicOrgRepo } from "@app/modules/public/organization/data/makePublicOrgRepo";
import { makePublicEventsOverviewRepo } from "@app/modules/public/organization/data/makePublicEventsOverviewRepo";

import type { PublicOrgBySlug } from "../schemas/public.orgBySlug.schema";
import type { PublicEventOverview } from "../schemas/public.orgEventsOverview.schema";
import { normalizeError } from "@errors/errors";

type State = {
  loading: boolean;
  error: string | null;

  orgSlug: string | null;

  org: PublicOrgBySlug["org"] | null;
  profile: PublicOrgBySlug["profile"] | null;

  events: PublicEventOverview[];
};

export function usePublicOrgData(params: {
  supabase: SupabaseClient;
  orgSlug: string | null | undefined;
}) {
  const { supabase, orgSlug } = params;

  const orgRepo = useMemo(() => makePublicOrgRepo(supabase), [supabase]);
  const eventsRepo = useMemo(
    () => makePublicEventsOverviewRepo(supabase),
    [supabase],
  );

  const [state, setState] = useState<State>({
    loading: true,
    error: null,

    orgSlug: orgSlug ? String(orgSlug) : null,

    org: null,
    profile: null,
    events: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const slug = (orgSlug ?? "").trim();

      if (!slug) {
        setState({
          loading: false,
          error: "Slug manquant",
          orgSlug: null,
          org: null,
          profile: null,
          events: [],
        });
        return;
      }

      try {
        setState({
          loading: true,
          error: null,
          orgSlug: slug,
          org: null,
          profile: null,
          events: [],
        });

        // 1) org info
        const orgData = await orgRepo.getPublicOrgBySlug(slug);
        if (cancelled) return;

        // 2) events
        const overview = await eventsRepo.getPublicOrgEventsOverview(slug);
        if (cancelled) return;

        setState({
          loading: false,
          error: null,
          orgSlug: slug,
          org: orgData.org,
          profile: orgData.profile,
          events: overview.events,
        });
      } catch (e: unknown) {
        if (cancelled) return;

        const ne = normalizeError(
          e,
          "Impossible de charger la page de l’organisation",
        );

        setState({
          loading: false,
          error: ne.message,
          orgSlug: slug,
          org: null,
          profile: null,
          events: [],
        });
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [orgSlug, orgRepo, eventsRepo]);

  const selectedSlug = orgSlug?.trim() || null;
  return state.orgSlug === selectedSlug
    ? state
    : {
        loading: Boolean(selectedSlug),
        error: null,
        orgSlug: selectedSlug,
        org: null,
        profile: null,
        events: [],
      };
}
