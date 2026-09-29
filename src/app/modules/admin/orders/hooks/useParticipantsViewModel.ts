import { useMemo } from "react";
import { normalizeText } from "@helpers/normalize";
import { isFilled } from "@helpers/fields";
import type { Attendee } from "@shared/models/db/db.attendee.schema";
import type { AttendeeAnswers } from "@shared/models/db/db.attendeeAnswers.schema";
import type { EventDetailAdmin } from "../../singleEvent/schemas/admin.eventDetail.schema";
import type { EventFormField } from "@shared/models/db/db.eventFormFields.schema";

export type FilterMode = "all" | "order" | `field:${string}`;

type OrderRow = EventDetailAdmin["orders"]["rows"][number];
type OrderItemRow = EventDetailAdmin["orderItems"][number];
type ProductRow = EventDetailAdmin["products"][number];

export type OrderMeta = {
  orderNumber: string;
  createdAt?: string | undefined;
  status:
    | "pending"
    | "awaiting_payment"
    | "partially_paid"
    | "expired"
    | "canceled"
    | "paid"
    | "refunded";

  currency: string;

  totalCents: number;
  paidCents: number;
  discountCents: number;
  dueCents: number;

  buyerEmail?: string | undefined;

  promoRedemption?: {
    id: string;
    promoCodeId: string;
    code: string | null;
    discountCents: number;
    createdAt: string;
  } | null;

  nonAttendeeItems?:
    | {
        id: string;
        name: string;
        quantity: number;
      }[]
    | undefined;
};

type FilledField = {
  key: string;
  label: string;
  value: string;
  groupId?: string | null;
  fieldType?: string | null;
  sortOrder?: number;
};

export type BuildParticipantsViewModelParams = {
  localAttendees: Attendee[];
  localAnswers: AttendeeAnswers[];
  localOrders: OrderRow[];
  localOrderItems: OrderItemRow[];
  query: string;
  filterMode: FilterMode;
  productsRows: ProductRow[];
  regFields: EventFormField[];
};

function stringifyAnswerValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (value == null) return "";

  if (Array.isArray(value)) {
    return value
      .map((v) => String(v ?? ""))
      .filter(Boolean)
      .join(", ");
  }

  try {
    return String(value);
  } catch {
    return "";
  }
}

export function buildParticipantsViewModel(
  params: BuildParticipantsViewModelParams,
) {
  const {
    localAttendees,
    localAnswers,
    localOrders,
    localOrderItems,
    productsRows,
    regFields,
    query,
    filterMode,
  } = params;

  const createsAttendeesByProductId = new Map<string, boolean>();

  for (const p of productsRows) {
    createsAttendeesByProductId.set(p.id, Boolean(p.createsAttendees));
  }

  const regFieldByKey = new Map<string, EventFormField>();
  for (const f of regFields) {
    const key = String(f.fieldKey ?? "").trim();
    if (!key) continue;
    regFieldByKey.set(key, f);
  }

  /* -------------------- ORDER META -------------------- */
  const itemsByOrderId = new Map<string, OrderItemRow[]>();

  for (const item of localOrderItems) {
    const arr = itemsByOrderId.get(item.orderId) ?? [];
    arr.push(item);
    itemsByOrderId.set(item.orderId, arr);
  }

  const orderMetaById = new Map<string, OrderMeta>();

  for (const o of localOrders) {
    const total = o.totalCents ?? 0;
    const paid = o.paidCents ?? 0;

    const discount = o.discountCents ?? o.promoRedemption?.discountCents ?? 0;

    const due =
      typeof o.dueCents === "number"
        ? o.dueCents
        : Math.max(0, total - discount - paid);

    const orderItems = itemsByOrderId.get(o.id) ?? [];

    const nonAttendeeItems = orderItems
      .filter((item) => {
        const createsAttendees = item.productId
          ? (createsAttendeesByProductId.get(item.productId) ?? true)
          : true;

        const quantity = Number(item.quantity ?? 0);
        return !createsAttendees && quantity > 0;
      })
      .map((item) => ({
        id: item.id,
        name: item.productNameSnapshot || "Billet",
        quantity: Number(item.quantity ?? 0),
      }));

    orderMetaById.set(o.id, {
      orderNumber: o.id.slice(0, 8),
      createdAt: o.createdAt,
      status: o.status,
      currency: o.currency ?? "EUR",

      totalCents: total,
      paidCents: paid,
      discountCents: discount,
      dueCents: due,

      promoRedemption: o.promoRedemption ?? null,

      buyerEmail: o.buyerEmail ?? undefined,
      nonAttendeeItems,
    });
  }

  /* -------------------- ANSWERS BY ATTENDEE (FILLED) -------------------- */
  const filledFieldsByAttendeeId = new Map<string, FilledField[]>();

  for (const a of localAnswers) {
    if (!isFilled(a.value)) continue;

    const key = String(a.fieldKeySnapshot ?? "").trim();
    if (!key) continue;

    const regField = regFieldByKey.get(key);

    const arr = filledFieldsByAttendeeId.get(a.attendeeId) ?? [];
    arr.push({
      key,
      label: regField?.label ?? a.fieldLabelSnapshot ?? key,
      value: stringifyAnswerValue(a.value),
      groupId: regField?.groupId ?? null,
      fieldType: regField?.fieldType ?? null,
      sortOrder: regField?.sortOrder ?? 0,
    });
    filledFieldsByAttendeeId.set(a.attendeeId, arr);
  }

  for (const [id, arr] of filledFieldsByAttendeeId.entries()) {
    const uniq = new Map<string, FilledField>();
    for (const f of arr) uniq.set(f.key, f);

    const list = Array.from(uniq.values());
    list.sort((x, y) => {
      const byOrder = (x.sortOrder ?? 0) - (y.sortOrder ?? 0);
      if (byOrder !== 0) return byOrder;
      return x.label.localeCompare(y.label);
    });

    filledFieldsByAttendeeId.set(id, list);
  }

  /* -------------------- FIELDS OPTIONS -------------------- */
  const fieldsMap = new Map<string, string>();

  for (const f of regFields) {
    const key = String(f.fieldKey ?? "").trim();
    const label = String(f.label ?? "").trim() || key;
    if (!key) continue;
    if (!fieldsMap.has(key)) fieldsMap.set(key, label);
  }

  for (const a of localAnswers) {
    const key = String(a.fieldKeySnapshot ?? "").trim();
    const label = a.fieldLabelSnapshot || key;
    if (!key) continue;
    if (!fieldsMap.has(key)) fieldsMap.set(key, label);
  }

  const fieldOptions = Array.from(fieldsMap.entries())
    .map(([key, label]) => ({ key, label }))
    .sort((x, y) => x.label.localeCompare(y.label));

  /* -------------------- IDENTITY -------------------- */
  const computeIdentity = (attendeeId: string) => {
    const fields = filledFieldsByAttendeeId.get(attendeeId) ?? [];
    const getVal = (...keys: string[]) =>
      fields.find((f) => keys.includes(f.key))?.value ?? "";

    const full = `${getVal("firstName", "prenom", "first_name")} ${getVal(
      "lastName",
      "nom",
      "last_name",
    )}`.trim();

    const email = getVal("email");

    return {
      title: full || email || "Participant",
      subtitle: email || "",
    };
  };

  /* -------------------- FILTERED ATTENDEES -------------------- */
  const q = normalizeText(query);

  const filteredAttendees = !q
    ? localAttendees
    : localAttendees.filter((att) => {
        const matchOrder = (orderId: string) => {
          const orderNum = orderMetaById.get(orderId)?.orderNumber ?? "";
          return normalizeText(orderNum).includes(q);
        };

        const matchAnyField = (attendeeId: string) => {
          const fields = filledFieldsByAttendeeId.get(attendeeId) ?? [];
          return fields.some((f) => normalizeText(f.value).includes(q));
        };

        const matchFieldKey = (attendeeId: string, key: string) => {
          const fields = filledFieldsByAttendeeId.get(attendeeId) ?? [];
          const found = fields.find((f) => f.key === key);
          return found ? normalizeText(found.value).includes(q) : false;
        };

        if (filterMode === "order") return matchOrder(att.orderId);

        if (filterMode.startsWith("field:")) {
          const key = filterMode.slice("field:".length);
          return key ? matchFieldKey(att.id, key) : false;
        }

        return matchOrder(att.orderId) || matchAnyField(att.id);
      });

  /* -------------------- GROUPS BY ORDER -------------------- */
  const byOrder = new Map<string, Attendee[]>();

  for (const a of filteredAttendees) {
    const arr = byOrder.get(a.orderId) ?? [];
    arr.push(a);
    byOrder.set(a.orderId, arr);
  }

  const orderMatchesQuery = (orderId: string) => {
    const orderNum = orderMetaById.get(orderId)?.orderNumber ?? "";
    return normalizeText(orderNum).includes(q);
  };

  const shouldShowOrder = (orderId: string) => {
    if (!q) return true;
    if (filterMode === "order") return orderMatchesQuery(orderId);
    if (filterMode.startsWith("field:"))
      return (byOrder.get(orderId) ?? []).length > 0;
    return (
      orderMatchesQuery(orderId) || (byOrder.get(orderId) ?? []).length > 0
    );
  };

  const visibleOrders = localOrders
    .map((o) => ({ orderId: o.id, createdAt: o.createdAt ?? "" }))
    .filter((x) => x.orderId)
    .filter((x) => shouldShowOrder(x.orderId));

  visibleOrders.sort((a, b) => {
    if (b.createdAt !== a.createdAt)
      return b.createdAt.localeCompare(a.createdAt);
    return b.orderId.localeCompare(a.orderId);
  });

  const groups: Array<[string, Attendee[]]> = [];

  for (const o of visibleOrders) {
    const arr = byOrder.get(o.orderId) ?? [];
    arr.sort((x, y) => (x.attendeeIndex ?? 0) - (y.attendeeIndex ?? 0));
    groups.push([o.orderId, arr]);
  }

  return {
    orderMetaById,
    filledFieldsByAttendeeId,
    fieldOptions,
    filteredAttendees,
    groups,
    computeIdentity,
  };
}

export function useParticipantsViewModel(
  params: BuildParticipantsViewModelParams,
) {
  const {
    localAttendees,
    localAnswers,
    localOrders,
    localOrderItems,
    query,
    filterMode,
    productsRows,
    regFields,
  } = params;

  return useMemo(
    () =>
      buildParticipantsViewModel({
        localAttendees,
        localAnswers,
        localOrders,
        localOrderItems,
        query,
        filterMode,
        productsRows,
        regFields,
      }),
    [
      localAttendees,
      localAnswers,
      localOrders,
      localOrderItems,
      query,
      filterMode,
      productsRows,
      regFields,
    ],
  );
}
