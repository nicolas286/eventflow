import { useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useNavigate } from "react-router-dom";

import { ConfirmDeleteModal } from "@ui/components/modals/ConfirmDeleteModal";

import "./AdminEventsPage.desktop.css";
import "./AdminEventsPage.mobile.css";
import "@app/modules/admin/dashboard/components/AdminAllEvents.desktop.css";

import AdminStats from "../../stats/components/AdminStats";
import EventEditor from "../../dashboard/components/EventEditor/EventEditor";
import EventTable from "../../dashboard/components/EventTable";
import { useEventEditorPanel } from "../../dashboard/components/EventEditor/useEventEditorPanel";

import type { AdminOutletContext } from "../../dashboard/components/AdminDashboard";
import type { EventOverviewRow } from "../schemas/admin.eventsOverview.schema";

import { Button, EditorShell } from "@ui/components";
import { supabase } from "@gateways/supabase/supabaseClient";
import { useCreateEvent } from "../../singleEvent/hooks/useCreateEvent";
import { useUpdateEvent } from "../../singleEvent/hooks/useUpdateEvent";
import { useDeleteEvent } from "../../singleEvent/hooks/useDeleteEvent";
import { useDuplicateEvent } from "../../singleEvent/hooks/useDuplicateEvent";
import { PlusIcon } from "@ui/components/icon/Icons";
import { MessageBox } from "@shared/ui/components/message/MessageBox";
import { AdminPageHeader } from "../../dashboard/components/AdminPageHeader/AdminPageHeader";

type EditableEventFields = Partial<
  Pick<
    EventOverviewRow["event"],
    "title" | "isPublished" | "startsAt" | "endsAt"
  >
> & { location?: string | null };

type ConfirmState = {
  open: boolean;
  eventId: string | null;
  title: string | null;
};

export default function AdminEventsPage() {
  const { events, orgId, bootstrap, refetch } =
    useOutletContext<AdminOutletContext>();

  const {
    createEvent,
    loading: creating,
    error: createError,
    reset: resetCreate,
    isCurrentScope: isCreateScopeCurrent,
  } = useCreateEvent({ supabase, orgId });

  const {
    duplicateEvent: doDuplicate,
    loading: duplicating,
    error: duplicateError,
    reset: resetDuplicate,
    isCurrentScope: isDuplicateScopeCurrent,
  } = useDuplicateEvent({ supabase, orgId });

  const {
    updateEvent: doUpdate,
    loading: saving,
    error: saveError,
    reset: resetSave,
    isCurrentScope: isUpdateScopeCurrent,
  } = useUpdateEvent({ supabase, orgId });

  const {
    deleteEvent: doDelete,
    loading: deleting,
    error: deleteError,
    reset: resetDelete,
    isCurrentScope: isDeleteScopeCurrent,
  } = useDeleteEvent({ supabase, orgId });

  const { selectedRow, editingId, select, closeIf, onAnimEnd, panelClassName } =
    useEventEditorPanel(events);

  const [confirm, setConfirm] = useState<ConfirmState>({
    open: false,
    eventId: null,
    title: null,
  });

  const stats = useMemo(() => {
    const totalEvents = events.length;
    const publishedEvents = events.filter((e) => e.event.isPublished).length;
    const draftEvents = events.filter((e) => !e.event.isPublished).length;
    return { totalEvents, publishedEvents, draftEvents };
  }, [events]);

  const updateEvent = async (id: string, patch: EditableEventFields) => {
    if (!isUpdateScopeCurrent()) return;
    if (!patch || Object.keys(patch).length === 0) return;

    resetSave();

    const updated = await doUpdate({ eventId: id, patch });
    if (!updated || !isUpdateScopeCurrent()) return;

    await refetch();
  };

  const deleteEvent = (id: string) => {
    resetDelete();
    const row = events.find((e) => e.event.id === id);

    setConfirm({
      open: true,
      eventId: id,
      title: row?.event.title ?? "cet événement",
    });
  };

  const cancelDelete = () => {
    resetDelete();
    setConfirm({ open: false, eventId: null, title: null });
  };

  const confirmDelete = async () => {
    if (!isDeleteScopeCurrent()) return;
    if (!confirm.eventId) return;

    closeIf(confirm.eventId);

    const ok = await doDelete({ eventId: confirm.eventId, orgId });
    if (!ok || !isDeleteScopeCurrent()) return;

    await refetch();
    if (!isDeleteScopeCurrent()) return;
    cancelDelete();
  };

  const navigate = useNavigate();

  const addEvent = async () => {
    if (!isCreateScopeCurrent()) return;
    if (creating) return;

    resetCreate();

    const created = await createEvent({
      orgId,
      title: "Nouvel événement",
      description: null,
      charterText: null,
      location: null,
      bannerUrl: null,
      depositCents: null,
      startsAt: null,
      endsAt: null,
    });

    if (!created || !isCreateScopeCurrent()) return;

    await refetch();
    if (!isCreateScopeCurrent()) return;
    navigate(`/admin/events/${created.slug}`);
  };

  const duplicateEvent = async (row: EventOverviewRow) => {
    if (!isDuplicateScopeCurrent()) return;
    if (duplicating) return;

    resetDuplicate();

    const duplicated = await doDuplicate({
      sourceEventId: row.event.id,
      title: `${row.event.title} (copie)`,
    });

    if (!duplicated || !isDuplicateScopeCurrent()) return;

    await refetch();
    if (!isDuplicateScopeCurrent()) return;
    navigate(`/admin/events/${duplicated.slug}`);
  };

  const isEditorVisible = !!selectedRow;

  return (
    <>
      <AdminPageHeader
        eyebrow="Pilotage"
        title="Vos événements"
        description="Créez, publiez et suivez vos événements depuis un espace unique. Les commandes et recettes restent visibles en un coup d’œil."
        actions={
          <Button
            label={creating ? "Création…" : "Nouvel événement"}
            onClick={addEvent}
            disabled={creating}
          >
            <PlusIcon />
            {creating ? "Création…" : "Nouvel événement"}
          </Button>
        }
      />

      <div className="adminAllEventsWrap">
        <div className="adminAllEventsCard adminAllEventsCard--compact">
          <div className="adminAllEventsInner">
            <AdminStats stats={stats} />
          </div>
        </div>
      </div>

      <div className="adminAllEventsWrap">
        <div className="adminAllEventsCard">
          <div className="adminAllEventsHeader">
            <div>
              <h2 className="adminAllEventsTitle">Tous les événements</h2>
              <div className="adminAllEventsHint">
                {events.length} événement(s)
                {isEditorVisible ? (
                  <span className="adminAllEventsDot">• Éditeur ouvert</span>
                ) : null}
              </div>
            </div>
          </div>

          {(createError || saveError || deleteError || duplicateError) && (
            <MessageBox variant="error">
              {createError ?? saveError ?? deleteError ?? duplicateError}
            </MessageBox>
          )}

          <EditorShell
            isOpen={Boolean(selectedRow)}
            onRequestClose={() => {
              if (selectedRow) closeIf(selectedRow.event.id);
            }}
            editorWidth={440}
            editorGap={24}
            stickyTop={120}
            left={
              <EventTable
                events={events}
                orgSlug={bootstrap.organizationProfile?.slug}
                editingId={editingId}
                onSelect={select}
                onDelete={deleteEvent}
                onDuplicate={duplicateEvent}
                renderInlineEditor={(row) => {
                  if (!selectedRow) return null;
                  if (selectedRow.event.id !== row.event.id) return null;

                  return (
                    <div className="adminEventsInlineEditor">
                      <div
                        className={`adminEventsEditorPanel adminEventsEditorPanel--inline ${panelClassName}`}
                        key={selectedRow.event.id}
                        onAnimationEnd={onAnimEnd}
                      >
                        <EventEditor
                          event={selectedRow}
                          onUpdateEvent={(patch) =>
                            void updateEvent(selectedRow.event.id, patch)
                          }
                        />
                        {saving && (
                          <div className="adminEventsSavingHint">
                            Enregistrement…
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }}
              />
            }
            right={
              selectedRow ? (
                <div
                  className={`adminEventsEditorPanel ${panelClassName}`}
                  key={selectedRow.event.id}
                  onAnimationEnd={onAnimEnd}
                >
                  <EventEditor
                    event={selectedRow}
                    onUpdateEvent={(patch) =>
                      void updateEvent(selectedRow.event.id, patch)
                    }
                  />
                  {saving && (
                    <div className="adminEventsSavingHint">Enregistrement…</div>
                  )}
                </div>
              ) : (
                <div />
              )
            }
          />
        </div>
      </div>

      <ConfirmDeleteModal
        open={confirm.open}
        title="Supprimer l’événement ?"
        eventName={confirm.title}
        busy={deleting}
        error={deleteError}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </>
  );
}
