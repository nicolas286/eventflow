import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import { supabase } from "@gateways/supabase/supabaseClient";
import { EventPromoCodesPanel } from "./EventPromoCodesPanel";

import type { AdminEventDetailEvent } from "../../singleEvent/schemas/admin.eventDetail.schema";

export function SingleEventPromoCodesSection(props: {
  orgId: string | null;
  event: AdminEventDetailEvent;
  onChanged: () => Promise<void>;
}) {
  const { orgId, event, onChanged } = props;
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);

  return (
    <EventPromoCodesPanel
      key={JSON.stringify([sessionScope, orgId, event.id])}
      supabase={supabase}
      orgId={orgId}
      event={event}
      onChanged={onChanged}
    />
  );
}