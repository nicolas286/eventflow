import "./EventEditor.desktop.css";
import "./EventEditor.mobile.css";
import { Card, CardBody, CardHeader } from "@ui/components";
import type { EventOverviewRow } from "@app/modules/admin/events/schemas/admin.eventsOverview.schema";
import EventEditorForm from "./EventEditorForm";
import type { AdminEventDetailEvent } from "@app/modules/admin/singleEvent/schemas/admin.eventDetail.schema";

export type EditableEventFields = Partial<
  Pick<
    EventOverviewRow["event"],
    "title" | "isPublished" | "startsAt" | "endsAt"
  >
> & { location?: string | null };

type Props = {
  event: EventOverviewRow | null;
  onUpdateEvent: (patch: EditableEventFields) => void;
};

export default function EventEditor({ event, onUpdateEvent }: Props) {
  if (!event) {
    return (
      <Card className="eventEditorCard">
        <CardHeader
          className="eventEditorCard__header"
          title="Modification rapide"
          subtitle="Sélectionnez un événement"
        />
        <CardBody>
          <div className="eventEditor__empty">Aucun événement sélectionné.</div>
        </CardBody>
      </Card>
    );
  }

  const ev = event.event as Partial<AdminEventDetailEvent>;

  return (
    <Card className="eventEditorCard">
      <CardHeader
        className="eventEditorCard__header"
        title={
          <div className="eventEditorCard__heading">
            <span>Modification rapide</span>
            <strong>{ev.title}</strong>
          </div>
        }
        subtitle="Modifiez les informations essentielles sans quitter la liste."
      />
      <CardBody className="eventEditorCard__body">
        <EventEditorForm key={ev.id} event={ev} onConfirm={onUpdateEvent} />
      </CardBody>
    </Card>
  );
}
