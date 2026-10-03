import { useAuth } from "@providers/AuthProvider/useAuth";
import { getSessionScope } from "@gateways/supabase/sessionScope";
import { supabase } from "@gateways/supabase/supabaseClient";
import { EventRegistrationFormPanel } from "../../singleEvent/components/EventRegistrationFormPanel";

import type { AdminEventDetailEvent } from "../../singleEvent/schemas/admin.eventDetail.schema";
import type { EventFormField, EventFormFieldGroup } from "@shared/models/db/db.eventFormFields.schema";

export function SingleEventFormSection(props: {
  orgId: string;
  event: AdminEventDetailEvent;
  fields: EventFormField[];
  fieldsGroups: EventFormFieldGroup[];
  onChanged: () => Promise<void>;
}) {
  const { orgId, event, fields, fieldsGroups, onChanged } = props;
  const { session } = useAuth();
  const sessionScope = getSessionScope(session);

  return (
    <EventRegistrationFormPanel
      key={JSON.stringify([sessionScope, orgId, event.id])}
      orgId={orgId}
      supabase={supabase}
      event={event}
      fields={fields}
      fieldsGroups={fieldsGroups}
      onChanged={onChanged}
    />
  );
}