import { useMemo, useState } from "react";

import { supabase } from "@gateways/supabase/supabaseClient";
import { FlexPanel } from "@ui/components/panels/FlexPanel";

import { SingleEventOrdersSubSection } from "./SingleEventOrdersSubSection";
import { SingleEventTicketsSubSection } from "./SingleEventTicketsSubSection";

import { useAdminSingleEventOrdersViewData } from "../hooks/useMakeEventAdminOrdersView";

import type { AdminEventDetailEvent } from "../../singleEvent/schemas/admin.eventDetail.schema";
import type { EventFormField, EventFormFieldGroup } from "@shared/models/db/db.eventFormFields.schema";
import type { EventProducts } from "@shared/models/db/db.eventProducts.schema";

import "./attendees.css";
import type { ParticipantsTabKey } from "../../singleEvent/hooks/useAdminSingleEventPageParams";

type SubView = "orders" | "tickets";

const ORDERS_PAGE_SIZE = 25;

export function SingleEventParticipantsSection(props: {
  orgId: string | null | undefined;
  eventSlug: string;
  event: AdminEventDetailEvent;
  products: EventProducts;
  formFields: EventFormField[];
  formFieldsGroups: EventFormFieldGroup[]
  onChanged?: () => Promise<void>;
  initialTab?: ParticipantsTabKey;
  autoOpenScanner?: boolean;
  onScannerAutoOpened?: () => void;
}) {
  const {
    orgId,
    eventSlug,
    event,
    products,
    formFields,
    formFieldsGroups,
    onChanged,
    initialTab,
    autoOpenScanner,
    onScannerAutoOpened,
  } = props;

  const [manualSubView, setManualSubView] = useState<SubView | null>(null);
  const [ordersPage, setOrdersPage] = useState(0);

  const defaultSubView: SubView =
    autoOpenScanner || initialTab === "tickets" ? "tickets" : "orders";

  const subView: SubView = manualSubView ?? defaultSubView;


  const ordersOffset = ordersPage * ORDERS_PAGE_SIZE;
  const ordersEnabled = subView === "orders" && Boolean(orgId) && Boolean(eventSlug);

  const {
    data: ordersViewData,
    loading: ordersViewLoading,
    error: ordersViewError,
    refetch: refetchOrdersView,
  } = useAdminSingleEventOrdersViewData({
    supabase,
    orgId,
    eventSlug,
    ordersLimit: ORDERS_PAGE_SIZE,
    ordersOffset,
    enabled: ordersEnabled,
  });

  const orders = ordersViewData?.orders ?? null;
  const orderItems = ordersViewData?.orderItems ?? null;
  const payments = ordersViewData?.payments ?? null;
  const attendees = ordersViewData?.attendees ?? null;
  const attendeeAnswers = ordersViewData?.attendeeAnswers ?? null;

  const totalOrders = orders?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalOrders / ORDERS_PAGE_SIZE));
  const safePage = Math.min(ordersPage, totalPages - 1);

  const wrappedOnChanged = useMemo(() => {
    if (!onChanged) {
      return async () => {
        await refetchOrdersView();
      };
    }

    return async () => {
      await onChanged();
      await refetchOrdersView();
    };
  }, [onChanged, refetchOrdersView]);

  return (
    <FlexPanel>
      <div className="adminParticipantsCard">
        <div className="adminParticipantsHeader">
          <div>
            <h3 className="adminParticipantsTitle">Participants</h3>
            <div className="adminParticipantsHint">
              Gérez les commandes et les tickets de l’événement
            </div>
          </div>
        </div>

        <div className="adminSubtabs" role="tablist" aria-label="Sous-vues participants">
          <button
            type="button"
            role="tab"
            aria-selected={subView === "orders"}
            className={subView === "orders" ? "adminSubtab isActive" : "adminSubtab"}
            onClick={() => setManualSubView("orders")}
          >
            Commandes
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={subView === "tickets"}
            className={subView === "tickets" ? "adminSubtab isActive" : "adminSubtab"}
            onClick={() => setManualSubView("tickets")}
          >
            Tickets
          </button>
        </div>

        {subView === "orders" && ordersViewError && ordersViewData ? (
          <div className="adminEventEmpty" role="alert">{ordersViewError}</div>
        ) : null}
        {subView === "orders" ? (
          ordersViewLoading && !ordersViewData ? (
            <div className="adminEventEmpty">Chargement des commandes…</div>
          ) : ordersViewError && !ordersViewData ? (
            <div className="adminEventEmpty">{ordersViewError}</div>
          ) : orders && orderItems && payments && attendees && attendeeAnswers ? (
            <SingleEventOrdersSubSection
              key={`${orgId}:${event.id}`}
              orgId={orgId}
              event={event}
              products={products}
              formFields={formFields}
              formFieldsGroups={formFieldsGroups}
              orders={orders}
              orderItems={orderItems}
              payments={payments}
              attendees={attendees}
              attendeeAnswers={attendeeAnswers}
              ordersPage={safePage}
              ordersPageSize={ORDERS_PAGE_SIZE}
              onOrdersPageChange={setOrdersPage}
              onChanged={wrappedOnChanged}
            />
          ) : (
            <div className="adminEventEmpty">Impossible de charger les commandes.</div>
          )
        ) : (
          <SingleEventTicketsSubSection
            key={`${orgId}:${event.id}`}
            eventId={event.id ?? ""}
            eventTitle={event.title ?? "Événement"}
            onChanged={onChanged}
            autoOpenScanner={autoOpenScanner}
            onScannerAutoOpened={onScannerAutoOpened}
          />
        )}
      </div>
    </FlexPanel>
  );
}
