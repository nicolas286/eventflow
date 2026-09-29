import type { ComponentProps } from "react";
import { Fragment, useRef } from "react";

import { Button } from "@ui/components";
import { PersonCard } from "./PersonCard";
import { AttendeeEditorPanel } from "../../singleEvent/components/AttendeeEditorPanel";
import { formatDateTime } from "@helpers/normalize";
import type { Attendee } from "@shared/models/db/db.attendee.schema";
import { formatMoney } from "@helpers/normalize";
import type { OrderMeta } from "../hooks/useParticipantsViewModel";
import type { EventFormFieldGroup } from "@shared/models/db/db.eventFormFields.schema";

export type FilledField = {
  key: string;
  label: string;
  value: string;
  groupId?: string | null;
  fieldType?: string | null;
};

export type Identity = { title: string; subtitle: string };

type AttendeeEditorProps = ComponentProps<typeof AttendeeEditorPanel>;

type FilledFieldGroupSection = {
  id: string | null;
  label: string | null;
  fields: FilledField[];
};

function formatFilledValue(field: FilledField): string {
  if (field.fieldType === "checkbox") {
    if (field.value === "true") return "Oui";
    if (field.value === "false") return "Non";
  }

  return field.value;
}

function groupFilledFields(
  filled: FilledField[],
  formFieldsGroups: EventFormFieldGroup[],
): FilledFieldGroupSection[] {
  const groupsSorted = [...formFieldsGroups].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );

  const ungrouped = filled.filter((f) => !f.groupId);

  const grouped = groupsSorted
    .map((group) => ({
      id: group.id,
      label: group.label,
      fields: filled.filter((f) => f.groupId === group.id),
    }))
    .filter((section) => section.fields.length > 0);

  if (ungrouped.length > 0) {
    return [
      {
        id: null,
        label: null,
        fields: ungrouped,
      },
      ...grouped,
    ];
  }

  return grouped;
}

type OrdersPeopleListProps = {
  groups: Array<[orderId: string, people: Attendee[]]>;
  orderMetaById: Map<string, OrderMeta>;
  filledFieldsByAttendeeId: Map<string, FilledField[]>;
  formFieldsGroups: EventFormFieldGroup[];
  computeIdentity: (attendeeId: string) => Identity;

  isMobile: boolean;

  targetOrderId: string | null;
  deleteOrderLoading: boolean;
  onRequestDeleteOrder: (orderId: string) => void;
  bankTransferOrderIds: Set<string>;
  markPaidLoadingOrderId: string | null;
  onRequestMarkPaid: (orderId: string) => void;

  editorOpen: boolean;
  editingAttendeeId: string | null;

  inlineEditorProps: Omit<
    AttendeeEditorProps,
    "layout" | "stickyTop" | "editorWidth" | "editorGap" | "left"
  >;

  onOpenEdit: (attendeeId: string, orderId: string) => void;
};

export function OrdersPeopleList(props: OrdersPeopleListProps) {
  const {
    groups,
    orderMetaById,
    filledFieldsByAttendeeId,
    formFieldsGroups,
    computeIdentity,
    isMobile,
    targetOrderId,
    deleteOrderLoading,
    onRequestDeleteOrder,
    bankTransferOrderIds,
    markPaidLoadingOrderId,
    onRequestMarkPaid,
    editorOpen,
    editingAttendeeId,
    inlineEditorProps,
    onOpenEdit,
  } = props;

  const topRef = useRef<HTMLDivElement | null>(null);

  return (
    <>
      <div ref={topRef} />

      <div className="adminOrdersGrid">
        {groups.map(([orderId, people]) => {
          const meta = orderMetaById.get(orderId);
          const orderNumber = meta?.orderNumber ?? orderId.slice(0, 8);
          const isDeletingThisOrder = deleteOrderLoading && targetOrderId === orderId;
          const canMarkPaid =
            bankTransferOrderIds.has(orderId) &&
            ["open", "pending", "awaiting_payment", "partially_paid"].includes(
              meta?.status ?? "",
            );
          const isMarkingPaid = markPaidLoadingOrderId === orderId;

          const total = meta?.totalCents ?? 0;
          const paid = meta?.paidCents ?? 0;
          const discount = meta?.discountCents ?? 0;
          const due = meta?.dueCents ?? Math.max(0, total - discount - paid);
          const currency = meta?.currency ?? "EUR";
          const isFree = total === 0;
          const hasDiscount = discount > 0;
          const promoCode = meta?.promoRedemption?.code?.trim() || null;
          const nonAttendeeItems = meta?.nonAttendeeItems ?? [];

          return (
            <div key={orderId} className="adminOrderCard">
              <div className="adminOrderHeader">
                <div>
                  <div className="adminOrderTitle">Commande {orderNumber}</div>
                    <div className="adminOrderSub">Créée le {formatDateTime(meta?.createdAt)}</div>
                    {meta?.buyerEmail ? (
                      <div className="adminOrderSub">
                        <b>Acheteur</b> {meta.buyerEmail}
                      </div>
                    ) : null}

                  {isFree ? (
                    <div className="adminOrderFree">Gratuit</div>
                  ) : (
                    <div className="adminOrderAmountsCompact">
                      <span>
                        <b>Total</b> {formatMoney(total, currency)}
                      </span>

                      {hasDiscount ? (
                        <>
                          <span className="adminDot">•</span>

                          <span>
                            <b>{promoCode ? `Code ${promoCode}` : "Réduction"}</b>{" "}
                            -{formatMoney(discount, currency)}
                          </span>
                        </>
                      ) : null}

                      <span className="adminDot">•</span>

                      <span>
                        <b>Payé</b> {formatMoney(paid, currency)}
                      </span>

                      <span className="adminDot">•</span>

                      <span className="adminOrderDue">
                        <b>Reste</b> {formatMoney(due, currency)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="adminOrderHeaderRight">
                  <span className="adminOrderPill">
                    {people.length} inscrit{people.length > 1 ? "s" : ""}
                  </span>

                  {canMarkPaid ? (
                    <Button
                      variant="primary"
                      onClick={() => onRequestMarkPaid(orderId)}
                      disabled={isMarkingPaid}
                    >
                      {isMarkingPaid ? "Confirmation…" : "Marquer comme payé"}
                    </Button>
                  ) : null}

                  <Button
                    variant="danger"
                    onClick={() => onRequestDeleteOrder(orderId)}
                    disabled={isDeletingThisOrder}
                  >
                    Supprimer la commande
                  </Button>
                </div>
              </div>

              <div className="adminOrderPeople">
                {people.map((att) => {
                  const identity = computeIdentity(att.id);
                  const filledRaw = filledFieldsByAttendeeId.get(att.id) ?? [];
                  const filled = filledRaw.map((f) => ({
                    ...f,
                    value: formatFilledValue(f),
                  }));

                  const filledGrouped = groupFilledFields(filled, formFieldsGroups);
                  const showInlineEditor = isMobile && editorOpen && editingAttendeeId === att.id;

                  return (
                    <Fragment key={att.id}>
                      <div className="adminPersonRow">
                        <PersonCard
                          att={att}
                          identity={identity}
                          filled={filled}
                          filledGrouped={filledGrouped}
                          onEdit={() => onOpenEdit(att.id, orderId)}
                        />
                      </div>

                      {showInlineEditor ? (
                        <div className="adminInlineEditorWrap">
                          <AttendeeEditorPanel {...inlineEditorProps} layout="inline" />
                        </div>
                      ) : null}
                    </Fragment>
                  );
                })}

                {nonAttendeeItems.length > 0 ? (
                  <div className="adminOrderExtraTickets">
                    <div className="adminOrderExtraTicketsTitle">
                      Billets sans participant
                    </div>

                    <div className="adminOrderExtraTicketsList">
                      {nonAttendeeItems.map((item) => (
                        <div key={item.id} className="adminOrderExtraTicketRow">
                          <span className="adminOrderExtraTicketName">{item.name}</span>
                          <span className="adminOrderExtraTicketQty">× {item.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
