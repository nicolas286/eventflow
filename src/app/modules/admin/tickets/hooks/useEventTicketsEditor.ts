import { useEffect, useMemo, useRef, useState, type SetStateAction } from "react";

import type { EventProduct, EventProducts } from "@shared/models/db/db.eventProducts.schema";
import type { CreateEventProductInput } from "../../products/schemas/admin.createEventProduct.schema";
import type { UpdateEventProductPatch } from "@app/modules/admin/products/data/updateEventProductRepo";

import { makeClientId, nonNegInt, posInt, sortBySortOrder } from "@helpers/logic";
import { toNullIfEmpty } from "@helpers/fields";
import { OrganizerMutationObsoleteError } from "../../singleEvent/hooks/useScopedEventMutation";

export type TicketDraft = {
  id: string | null;
  clientId: string;

  name: string;
  description: string;
  priceCents: number;
  currency: "EUR";
  stockQty: number | null;
  sortOrder: number;
  createsAttendees: boolean;
  attendeesPerUnit: number;
  isActive: boolean;
  isGatekeeper: boolean;
  closeEventWhenSoldOut: boolean;
};

type EditState = {
  id: string | null;
  name: string;
  description: string;
  priceCents: number;
  currency: "EUR";
  stockQty: number | null;
  sortOrder: number;
  createsAttendees: boolean;
  attendeesPerUnit: number;
  isActive: boolean;
  isGatekeeper: boolean;
  closeEventWhenSoldOut: boolean;
};

type MoveFx =
  | {
      aId: string;
      bId: string;
      dir: -1 | 1;
      nonce: number;
    }
  | null;

type ActionKind =
  | "created"
  | "updated"
  | "deleted"
  | "activated"
  | "deactivated"
  | "reordered";

type Params = {
  eventId: string | null;
  products: EventProducts;

  onCreate: (input: CreateEventProductInput) => Promise<void>;
  onUpdate: (input: { productId: string; patch: UpdateEventProductPatch }) => Promise<void>;
  onRemove?: (productId: string) => Promise<void>;
  onChanged?: () => void;
  isCurrentScope: () => boolean;

  onActionSuccess?: (kind: ActionKind) => void;
  onActionError?: (message: string) => void;

  createLoading?: boolean;
  updateLoading?: boolean;
  deleteLoading?: boolean;
};

export function useEventTicketsEditor({
  eventId,
  products,
  onCreate,
  onUpdate,
  onRemove,
  onChanged,
  isCurrentScope,
  onActionSuccess,
  onActionError,
  createLoading = false,
  updateLoading = false,
  deleteLoading = false,
}: Params) {
  const [draft, setDraft] = useState<TicketDraft[]>([]);

  const [editing, setEditingState] = useState<EditState | null>(null);
  const editorGenerationRef = useRef(0);
  function setEditing(next: SetStateAction<EditState | null>) {
    editorGenerationRef.current++;
    setEditingState(next);
  }
  const [creating, setCreating] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [moveFx, setMoveFx] = useState<MoveFx>(null);
  const moveFxTimerRef = useRef<number | null>(null);

  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const [query, setQuery] = useState("");
  const lastLoadedSigRef = useRef<string>("");

  const isSaving = createLoading || updateLoading || deleteLoading;
  const isFiltering = query.trim().length > 0;

  function productToDraft(p: EventProduct): TicketDraft {
    return {
      id: p?.id == null ? null : String(p.id),
      clientId: p?.id == null ? makeClientId() : String(p.id),
      name: String(p?.name ?? ""),
      description: String(p?.description ?? ""),
      priceCents: nonNegInt(p?.priceCents),
      currency: "EUR",
      stockQty: p?.stockQty == null ? null : nonNegInt(p.stockQty),
      sortOrder: nonNegInt(p?.sortOrder),
      createsAttendees: Boolean(p?.createsAttendees ?? true),
      attendeesPerUnit: posInt(p?.attendeesPerUnit),
      isActive: Boolean(p?.isActive ?? true),
      isGatekeeper: Boolean(p?.isGatekeeper ?? false),
      closeEventWhenSoldOut: Boolean(p?.closeEventWhenSoldOut ?? false),
    };
  }

  const incomingSig = useMemo(() => {
    const arr = sortBySortOrder(Array.isArray(products) ? products : []);

    return arr
      .map((p) => `${String(p?.id)}:${String(p?.updatedAt ?? "")}:${nonNegInt(p?.sortOrder)}`)
      .join("|");
  }, [products]);

  useEffect(() => {
    if (lastLoadedSigRef.current === incomingSig) return;

    const arr = sortBySortOrder(Array.isArray(products) ? products : []);
    const next = arr.map(productToDraft);

    setDraft(next);
    setError(null);
    lastLoadedSigRef.current = incomingSig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingSig]);

  useEffect(() => {
    return () => {
      if (moveFxTimerRef.current) window.clearTimeout(moveFxTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  function handleError(e: unknown, fallback = "Erreur inconnue") {
    if (e instanceof OrganizerMutationObsoleteError || !isCurrentScope()) return;
    const message = e instanceof Error ? e.message : fallback;
    setError(message);
    onActionError?.(message);
  }

  function clearError() {
    setError(null);
  }

  function armMoveFx(next: MoveFx) {
    setMoveFx(next);

    if (moveFxTimerRef.current) {
      window.clearTimeout(moveFxTimerRef.current);
    }

    moveFxTimerRef.current = window.setTimeout(() => {
      setMoveFx(null);
      moveFxTimerRef.current = null;
    }, 240);
  }

  function cancelClosingIfAny() {
    setIsClosing(false);
    setClosingKey(null);

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function openCreate() {
    cancelClosingIfAny();
    clearError();
    setCreating(true);

    setEditing({
      id: null,
      name: "",
      description: "",
      priceCents: 0,
      currency: "EUR",
      stockQty: null,
      sortOrder: (draft.at(-1)?.sortOrder ?? 0) + 1,
      createsAttendees: true,
      attendeesPerUnit: 1,
      isActive: true,
      isGatekeeper: false,
      closeEventWhenSoldOut: false,
    });
  }

  function openEdit(f: TicketDraft) {
    cancelClosingIfAny();
    clearError();
    setCreating(false);

    setEditing({
      id: f.clientId,
      name: f.name,
      description: f.description,
      priceCents: f.priceCents,
      currency: "EUR",
      stockQty: f.stockQty,
      sortOrder: f.sortOrder,
      createsAttendees: f.createsAttendees,
      attendeesPerUnit: f.attendeesPerUnit,
      isActive: f.isActive,
      isGatekeeper: f.isGatekeeper,
      closeEventWhenSoldOut: f.closeEventWhenSoldOut,
    });
  }

  function closeEditor() {
    if (!isCurrentScope()) return;
    if (!editing) {
      setCreating(false);
      return;
    }

    const key = creating ? "create" : editing.id;

    if (!key) {
      setEditing(null);
      setCreating(false);
      return;
    }

    setIsClosing(true);
    setClosingKey(key);
    const editorGeneration = editorGenerationRef.current;

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
    }

    closeTimerRef.current = window.setTimeout(() => {
      if (!isCurrentScope() || editorGeneration !== editorGenerationRef.current) return;
      setEditing(null);
      setCreating(false);
      setIsClosing(false);
      setClosingKey(null);
      closeTimerRef.current = null;
    }, 180);
  }

  function buildCreateInputFromEditing(): CreateEventProductInput | null {
    if (!eventId || !editing) return null;

    const name = String(editing.name ?? "").trim();
    if (!name) return null;

    return {
      eventId,
      name,
      description: toNullIfEmpty(String(editing.description ?? "")),
      priceCents: nonNegInt(editing.priceCents),
      currency: "EUR",
      stockQty: editing.stockQty == null ? null : nonNegInt(editing.stockQty),
      sortOrder: creating ? draft.length + 1 : nonNegInt(editing.sortOrder),
      createsAttendees: Boolean(editing.createsAttendees),
      attendeesPerUnit: editing.createsAttendees ? posInt(editing.attendeesPerUnit) : 1,
      isActive: Boolean(editing.isActive),
      isGatekeeper: Boolean(editing.isGatekeeper),
      closeEventWhenSoldOut: editing.isGatekeeper
        ? Boolean(editing.closeEventWhenSoldOut)
        : false,
    };
  }

  function createInputToPatch(input: CreateEventProductInput): UpdateEventProductPatch {
    return {
      name: input.name,
      description: input.description,
      priceCents: input.priceCents,
      currency: input.currency,
      stockQty: input.stockQty,
      sortOrder: input.sortOrder,
      createsAttendees: input.createsAttendees,
      attendeesPerUnit: input.attendeesPerUnit,
      isActive: input.isActive,
      isGatekeeper: input.isGatekeeper,
      closeEventWhenSoldOut: input.closeEventWhenSoldOut,
    };
  }

  async function saveEditor() {
    if (!isCurrentScope()) return;
    if (!eventId || !editing || isSaving) return;

    const input = buildCreateInputFromEditing();
    if (!input) return;
    const editorGeneration = editorGenerationRef.current;

    try {
      clearError();

      if (creating) {
        await onCreate(input);
        if (!isCurrentScope() || editorGeneration !== editorGenerationRef.current) return;
        onActionSuccess?.("created");
      } else {
        if (!editing.id) return;

        const current = draft.find((t) => t.clientId === editing.id);
        if (!current?.id) return;

        await onUpdate({
          productId: current.id,
          patch: createInputToPatch(input),
        });
        if (!isCurrentScope() || editorGeneration !== editorGenerationRef.current) return;

        onActionSuccess?.("updated");
      }

      closeEditor();
      onChanged?.();
    } catch (e) {
      if (editorGeneration !== editorGenerationRef.current) return;
      handleError(e, creating ? "Impossible de créer le ticket." : "Impossible de modifier le ticket.");
    }
  }

  async function togglePersisted(clientId: string, patch: Partial<Pick<TicketDraft, "isActive">>) {
    if (!isCurrentScope()) return;
    if (isSaving) return;

    const current = draft.find((t) => t.clientId === clientId);
    if (!current?.id) return;

    try {
      clearError();

      await onUpdate({
        productId: current.id,
        patch,
      });
      if (!isCurrentScope()) return;

      onActionSuccess?.(patch.isActive ? "activated" : "deactivated");
      onChanged?.();
    } catch (e) {
      handleError(e, "Impossible de modifier le ticket.");
    }
  }

  async function removePersisted(clientId: string) {
    if (!isCurrentScope()) return;
    if (isSaving || !onRemove) return;

    const current = draft.find((t) => t.clientId === clientId);
    if (!current?.id) return;

    const ok = window.confirm("Supprimer ce ticket ? (les commandes passées restent intactes)");
    if (!ok) return;
    const editorGeneration = editorGenerationRef.current;

    try {
      clearError();

      await onRemove(current.id);
      if (!isCurrentScope()) return;

      if (editing?.id === clientId && editorGeneration === editorGenerationRef.current) {
        closeEditor();
      }

      onActionSuccess?.("deleted");
      onChanged?.();
    } catch (e) {
      handleError(e, "Impossible de supprimer le ticket.");
    }
  }

  async function movePersisted(clientId: string, dir: -1 | 1) {
    if (!isCurrentScope()) return;
    if (isSaving || isFiltering) return;

    const sortedNow = sortBySortOrder(draft);

    const idx = sortedNow.findIndex((x) => x.clientId === clientId);
    if (idx < 0) return;

    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= sortedNow.length) return;

    const current = sortedNow[idx];
    const target = sortedNow[nextIdx];

    if (!current?.id || !target?.id) return;

    const currentOrder = nonNegInt(current.sortOrder);
    const targetOrder = nonNegInt(target.sortOrder);

    try {
      clearError();

      await onUpdate({
        productId: current.id,
        patch: { sortOrder: targetOrder },
      });
      if (!isCurrentScope()) return;

      await onUpdate({
        productId: target.id,
        patch: { sortOrder: currentOrder },
      });
      if (!isCurrentScope()) return;

      armMoveFx({
        aId: current.clientId,
        bId: target.clientId,
        dir,
        nonce: Date.now(),
      });

      onActionSuccess?.("reordered");
      onChanged?.();
    } catch (e) {
      handleError(e, "Impossible de réordonner le ticket.");
    }
  }

  const sorted = useMemo(() => sortBySortOrder(draft), [draft]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;

    return sorted.filter((t) => {
      const name = String(t.name ?? "").toLowerCase();
      const desc = String(t.description ?? "").toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  }, [sorted, query]);

  function getSoldQty(p: EventProduct | null | undefined) {
    return nonNegInt(p?.soldQty);
  }

  function formatStockLine(sold: number, stockQty: number | null | undefined) {
    if (stockQty == null) return `${sold} vendus / illimité`;

    const stock = nonNegInt(stockQty);
    const remaining = Math.max(0, stock - sold);

    return `${remaining} / ${stock}`;
  }

  return {
    // state
    draft,
    editing,
    creating,
    isSaving,
    error,
    moveFx,
    query,
    isFiltering,
    closingKey,
    isClosing,

    // derived
    sorted,
    filtered,

    // setters
    setEditing,
    setQuery,

    // actions
    openCreate,
    openEdit,
    closeEditor,
    saveEditor,
    togglePersisted,
    removePersisted,
    movePersisted,

    // helpers
    getSoldQty,
    formatStockLine,
  };
}
