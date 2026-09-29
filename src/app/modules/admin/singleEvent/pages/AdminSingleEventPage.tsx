import { useMemo } from "react";
import { useOutletContext, useParams, useNavigate } from "react-router-dom";

import type { AdminOutletContext } from "../../dashboard/components/AdminDashboard";
import { supabase } from "@gateways/supabase/supabaseClient";

import { useAdminSingleEventCoreData } from "../hooks/useAdminSingleEventCoreData";
import { useAdminSingleEventPageParams } from "../hooks/useAdminSingleEventPageParams";
import { useUpdateEvent } from "../hooks/useUpdateEvent";

import type { UpdateEventFullPatch } from "../schemas/admin.updateEventFullPatch.schema";

import { uploadOrgAssetsRepo } from "@gateways/supabase/repositories/dashboard/uploadOrgAssets.repo";
import type { UploadResult } from "@gateways/supabase/repositories/dashboard/uploadOrgAssets.repo";

import { SingleEventDetailsSection } from "../components/SingleEventDetailsTab";
import { SingleEventTicketsSection } from "../../tickets/components/SingleEventTicketsSection";
import { SingleEventFormSection } from "../../forms/components/SingleEventFormTab";
import { SingleEventParticipantsSection } from "../../orders/components/SingleEventParticipantsSection";
import { AdminSingleEventTabs } from "../components/AdminSingleEventTabs";
import { SingleEventPromoCodesSection } from "../../promoCodes/components/SingleEventPromoCodesTabs";
import { AdminPageHeader } from "../../dashboard/components/AdminPageHeader/AdminPageHeader";
import { Badge, Button } from "@ui/components";
import { ChevronLeftIcon } from "@ui/components/icon/Icons";
import { formatDateTimeHuman } from "@helpers/dateTime";

export function AdminSingleEventPage() {
  const { eventSlug } = useParams<{ eventSlug: string }>();
  const { orgId, refetch: refetchDashboard } =
    useOutletContext<AdminOutletContext>();

  const navigate = useNavigate();

  const {
    tab,
    setTab,
    participantsTab,
    shouldOpenScanner,
    consumeScannerFlag,
    searchParams,
  } = useAdminSingleEventPageParams();

  const storageRepo = useMemo(() => uploadOrgAssetsRepo(supabase), []);

  const core = useAdminSingleEventCoreData({
    supabase,
    orgId,
    eventSlug,
  });

  const update = useUpdateEvent({ supabase });

  if (!eventSlug) {
    return (
      <div className="adminCard">
        <h2>Événement</h2>
        <p>Slug manquant.</p>
      </div>
    );
  }

  const event = core.data?.event ?? null;

  const headerTitle = event?.title?.trim()
    ? event.title
    : core.loading
      ? "Chargement…"
      : "Événement";

  async function refreshAll() {
    if (typeof core.refetch === "function") {
      await core.refetch();
    }

    if (typeof refetchDashboard === "function") {
      await refetchDashboard();
    }
  }

  async function handleConfirmFullPatch(
    patch: UpdateEventFullPatch,
  ): Promise<void> {
    if (!event?.id) return;

    const normalizedPatch: UpdateEventFullPatch = {
      ...patch,
      endsAt:
        typeof patch.endsAt === "string" && patch.endsAt.trim() === ""
          ? null
          : patch.endsAt,
    };

    const next = await update.updateEvent({
      eventId: event.id,
      patch: normalizedPatch,
    });

    if (!next) return;

    const nextSlug = (next.slug ?? "").trim();

    if (nextSlug && nextSlug !== eventSlug) {
      navigate(`/admin/events/${nextSlug}?${searchParams.toString()}`, {
        replace: true,
      });
      return;
    }

    await refreshAll();
  }

  async function uploadEventBanner(file: File): Promise<UploadResult> {
    if (!orgId) throw new Error("ORG_ID_MISSING");
    if (!event?.id) throw new Error("EVENT_ID_MISSING");

    return storageRepo.uploadEventBanner({
      orgId,
      eventId: event.id,
      file,
    });
  }

  const showCoreLoading = core.loading;
  const showCoreError = core.error;

  return (
    <div className="adminSingleEventPage">
      <AdminPageHeader
        eyebrow="Gestion de l’événement"
        title={headerTitle}
        description="Configurez l’événement, sa billetterie et son formulaire, puis suivez les inscriptions depuis le même espace."
        visual={
          event?.bannerUrlEffective ? (
            <img src={event.bannerUrlEffective} alt="" />
          ) : null
        }
        meta={
          event ? (
            <>
              <Badge
                tone={event.isPublished ? "success" : "neutral"}
                label={event.isPublished ? "Publié" : "Brouillon"}
              />
              <span className="adminPageHeader__metaText">
                {formatDateTimeHuman(event.startsAt)}
              </span>
            </>
          ) : null
        }
        actions={
          <Button variant="secondary" onClick={() => navigate("/admin/events")}>
            <ChevronLeftIcon />
            Tous les événements
          </Button>
        }
      />

      <AdminSingleEventTabs activeTab={tab} onChange={setTab} />

      <div className="adminSingleEventPage__body">
        {showCoreLoading && (
          <div className="adminEventEmpty">Chargement de l’événement…</div>
        )}
        {showCoreError && (
          <div className="adminEventAlert isError">{showCoreError}</div>
        )}

        {!showCoreLoading && !showCoreError && core.data && event && (
          <>
            {tab === "details" && (
              <SingleEventDetailsSection
                event={event}
                updateError={update.error}
                onConfirm={handleConfirmFullPatch}
                onUploadBanner={uploadEventBanner}
              />
            )}

            {tab === "tickets" && (
              <SingleEventTicketsSection
                orgId={orgId}
                event={event}
                products={core.data.products}
                onChanged={refreshAll}
              />
            )}

            {tab === "form" && (
              <SingleEventFormSection
                event={event}
                fields={core.data.formFields}
                fieldsGroups={core.data.formFieldsGroups}
                onChanged={refreshAll}
              />
            )}

            {tab === "promoCodes" && (
              <SingleEventPromoCodesSection
                orgId={orgId}
                event={event}
                onChanged={refreshAll}
              />
            )}

            {tab === "participants" && (
              <SingleEventParticipantsSection
                key={`${eventSlug}-${
                  shouldOpenScanner ? "scanner" : participantsTab
                }`}
                orgId={orgId}
                eventSlug={eventSlug}
                event={event}
                products={core.data.products}
                formFields={core.data.formFields}
                formFieldsGroups={core.data.formFieldsGroups}
                onChanged={refreshAll}
                initialTab={shouldOpenScanner ? "tickets" : participantsTab}
                autoOpenScanner={shouldOpenScanner}
                onScannerAutoOpened={consumeScannerFlag}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
