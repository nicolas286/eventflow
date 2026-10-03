import { useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  EventFormField,
  EventFormFieldGroup,
  EventFormFieldOptions,
} from "@shared/models/db/db.eventFormFields.schema";
import { useCreateEventFormField } from "../../forms/hooks/useCreateEventFormField";
import { useUpdateEventFormField } from "../../forms/hooks/useUpdateEventFormField";
import { useDeleteEventFormField } from "../../forms/hooks/useDeleteEventFormField";
import { useCreateEventFormFieldGroup } from "../../forms/hooks/useCreateEventFormFieldGroup";
import { useUpdateEventFormFieldGroup } from "../../forms/hooks/useUpdateEventFormFieldGroup";
import { useDeleteEventFormFieldGroup } from "../../forms/hooks/useDeleteEventFormFieldGroup";
import { useReorderEventForm } from "../../forms/hooks/useReorderEventForm";
import { OrganizerMutationObsoleteError } from "../hooks/useScopedEventMutation";
import { Button, EditorShell, FilterBar } from "@ui/components";
import { FIELD_TYPES, type FieldType } from "@shared/constants/fieldTypes";
import { useMediaQuery } from "@helpers/ui";
import { slugKey } from "@helpers/normalize";
import { clampInt, uniqueKey } from "@helpers/logic";
import {
  optionsToText,
  sortFromDB,
  parseOptionsLines,
  optionsToInlineText,
} from "@helpers/fields";
import { TrashIcon } from "@ui/components/icon/Icons";
import { FlexPanel } from "@ui/components/panels/FlexPanel";
import { useToast } from "@shared/ui/components/toast/useToast";

import "./adminSingleEvent.form.desktop.css";
import "./adminSingleEvent.form.mobile.css";

type Props = {
  supabase: SupabaseClient;
  orgId: string;
  event: { id: string } | null;
  fields: EventFormField[];
  fieldsGroups: EventFormFieldGroup[];
  onChanged?: () => void;
};

type EditState = {
  id: string | null;
  label: string;
  fieldType: FieldType;
  groupId: string | null;
  isRequired: boolean;
  isActive: boolean;
  optionsText: string;
};

type GroupEditState = {
  id: string;
  label: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
};

export type DraftField = {
  id: string;
  clientId: string;
  label: string;
  fieldKey: string;
  fieldType: FieldType;
  groupId: string | null;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
  options: EventFormFieldOptions;
};

type MoveDir = "up" | "down";

export function EventRegistrationFormPanel(props: Props) {
  const { supabase, orgId, event, fields, fieldsGroups, onChanged } = props;
  const scope = { supabase, orgId, eventId: event?.id ?? "" };

  const isMobile = useMediaQuery("(max-width: 1050px)");
  const { showToast } = useToast();

  const create = useCreateEventFormField(scope);
  const update = useUpdateEventFormField(scope);
  const del = useDeleteEventFormField(scope);

  const createGroup = useCreateEventFormFieldGroup(scope);
  const updateGroup = useUpdateEventFormFieldGroup(scope);
  const deleteGroup = useDeleteEventFormFieldGroup(scope);

  const reorder = useReorderEventForm(scope);
  const isCurrentScope = () => create.isCurrentScope() && update.isCurrentScope() && del.isCurrentScope()
    && createGroup.isCurrentScope() && updateGroup.isCurrentScope() && deleteGroup.isCurrentScope()
    && reorder.isCurrentScope();
  const editorRevisionRef = useRef(0);
  const orderRevisionRef = useRef(0);

  const [draft, setDraft] = useState<DraftField[]>([]);

  const [editing, setEditingState] = useState<EditState | null>(null);
  const [editingKind, setEditingKind] = useState<"field" | "group" | null>(null);
  const [editingGroup, setEditingGroupState] = useState<GroupEditState | null>(null);
  const [creating, setCreating] = useState(false);

  const [newGroupLabel, setNewGroupLabelState] = useState("");
  const [newGroupDescription, setNewGroupDescriptionState] = useState("");

  function setEditing(next: SetStateAction<EditState | null>) {
    editorRevisionRef.current++;
    setEditingState(next);
  }
  function setEditingGroup(next: SetStateAction<GroupEditState | null>) {
    editorRevisionRef.current++;
    setEditingGroupState(next);
  }
  function setNewGroupLabel(next: SetStateAction<string>) {
    editorRevisionRef.current++;
    setNewGroupLabelState(next);
  }
  function setNewGroupDescription(next: SetStateAction<string>) {
    editorRevisionRef.current++;
    setNewGroupDescriptionState(next);
  }

  const [lastLoadedSig, setLastLoadedSig] = useState<string | null>(null);

  const [moveAnim, setMoveAnim] = useState<Record<string, MoveDir>>({});
  const moveTimerRef = useRef<number | null>(null);

  const [closingKey, setClosingKey] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<number | null>(null);

  const [query, setQuery] = useState("");
  const isFiltering = query.trim().length > 0;

  const isSaving =
    create.loading ||
    update.loading ||
    del.loading ||
    createGroup.loading ||
    updateGroup.loading ||
    deleteGroup.loading ||
    reorder.loading;

  const sortedGroups = useMemo(() => {
    return [...fieldsGroups].sort((a, b) => {
      const diff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });
  }, [fieldsGroups]);

  const incomingFieldsSig = useMemo(() => {
    return sortFromDB(fields)
      .map((f) => {
        const id = String(f.id);
        const updatedAt = f.updatedAt ?? "";
        const order = clampInt(f.sortOrder, { fallback: 0 });
        const groupId = f.groupId ?? "";
        const active = f.isActive ? "1" : "0";
        const required = f.isRequired ? "1" : "0";

        return `${id}:${updatedAt}:${order}:${groupId}:${active}:${required}:${f.label ?? ""}`;
      })
      .join("|");
  }, [fields]);

  const incomingGroupsSig = useMemo(() => {
    return sortedGroups
      .map((g) => {
        const order = clampInt(g.sortOrder ?? 0, { fallback: 0 });
        const active = g.isActive ? "1" : "0";
        return `${g.id}:${order}:${active}:${g.label ?? ""}:${g.description ?? ""}`;
      })
      .join("|");
  }, [sortedGroups]);

  const incomingSig = useMemo(() => {
    return `${incomingFieldsSig}__${incomingGroupsSig}`;
  }, [incomingFieldsSig, incomingGroupsSig]);

  useLayoutEffect(() => {
    // Invalidate old reorder responses before the refreshed order is painted.
    orderRevisionRef.current++;
  }, [incomingSig]);

  if (lastLoadedSig !== incomingSig) {
    const next: DraftField[] = sortFromDB(fields).map((f) => ({
      id: f.id,
      clientId: f.id,
      label: f.label ?? "",
      fieldKey: String(f.fieldKey ?? ""),
      fieldType: (f.fieldType ?? "text") as FieldType,
      groupId: f.groupId ?? null,
      isRequired: Boolean(f.isRequired),
      isActive: f.isActive ?? true,
      sortOrder: clampInt(f.sortOrder ?? 0, { fallback: 0 }),
      options: f.options ?? null,
    }));

    setDraft(next);
    setLastLoadedSig(incomingSig);
  }

  useEffect(() => {
    return () => {
      if (moveTimerRef.current) window.clearTimeout(moveTimerRef.current);
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    };
  }, []);

  const existingKeys = useMemo(() => {
    const s = new Set<string>();
    for (const f of draft) {
      const k = String(f.fieldKey ?? "").trim();
      if (k) s.add(k);
    }
    return s;
  }, [draft]);

  function buildKeyFromLabel(label: string) {
    const base = slugKey(label);
    return uniqueKey(base, existingKeys);
  }

  function buildOptions(fieldType: FieldType, optionsText: string) {
    if (fieldType === "select") return parseOptionsLines(optionsText);
    return null;
  }

  function cancelClosingIfAny() {
    setIsClosing(false);
    setClosingKey(null);

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }

  function resetHooks() {
    create.reset();
    update.reset();
    del.reset();
    createGroup.reset();
    updateGroup.reset();
    deleteGroup.reset();
    reorder.reset();
  }

  function openCreate() {
    setEditingKind("field");
    setEditingGroup(null);
    cancelClosingIfAny();
    resetHooks();

    setCreating(true);
    setEditing({
      id: null,
      label: "",
      fieldType: "text",
      groupId: null,
      isRequired: false,
      isActive: true,
      optionsText: "",
    });
  }

  function openEdit(f: DraftField) {
    setEditingKind("field");
    setEditingGroup(null);
    cancelClosingIfAny();
    resetHooks();

    setCreating(false);
    setEditing({
      id: f.clientId,
      label: f.label ?? "",
      fieldType: (f.fieldType ?? "text") as FieldType,
      groupId: f.groupId ?? null,
      isRequired: Boolean(f.isRequired),
      isActive: Boolean(f.isActive ?? true),
      optionsText: optionsToText(f.options ?? null),
    });
  }

  function openEditGroup(group: EventFormFieldGroup) {
    cancelClosingIfAny();
    resetHooks();

    setCreating(false);
    setEditingKind("group");
    setEditing(null);
    setEditingGroup({
      id: group.id,
      label: group.label ?? "",
      description: group.description ?? "",
      isActive: Boolean(group.isActive ?? true),
      sortOrder: clampInt(group.sortOrder ?? 0, { fallback: 0 }),
    });
  }

  function closeEditor() {
    if (!isCurrentScope()) return;
    const revision = editorRevisionRef.current;
    const key =
      editingKind === "group"
        ? editingGroup?.id ?? null
        : creating
          ? "create"
          : editing?.id ?? null;

    if (!key) {
      setEditing(null);
      setEditingGroup(null);
      setEditingKind(null);
      setCreating(false);
      return;
    }

    setIsClosing(true);
    setClosingKey(key);

    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);

    closeTimerRef.current = window.setTimeout(() => {
      if (!isCurrentScope() || revision !== editorRevisionRef.current) return;
      setEditing(null);
      setEditingGroup(null);
      setEditingKind(null);
      setCreating(false);
      setIsClosing(false);
      setClosingKey(null);
      resetHooks();
    }, 180);
  }

  function triggerMoveAnim(aId: string, aDir: MoveDir, bId?: string, bDir?: MoveDir) {
    if (moveTimerRef.current) window.clearTimeout(moveTimerRef.current);

    setMoveAnim((prev) => {
      const next = { ...prev, [aId]: aDir };
      if (bId && bDir) next[bId] = bDir;
      return next;
    });

    moveTimerRef.current = window.setTimeout(() => {
      if (!isCurrentScope()) return;
      setMoveAnim({});
      moveTimerRef.current = null;
    }, 220);
  }

  async function toggleFieldPersisted(
    field: DraftField,
    patch: Partial<Pick<DraftField, "isRequired" | "isActive">>
  ) {
    if (isSaving || !isCurrentScope()) return;

    const updated = await update.updateEventFormField({
      fieldId: field.id,
      patch,
    });
    if (!isCurrentScope()) return;

    if (!updated.ok) {
      showToast({
        title: "Modification impossible",
        description: updated.error,
        variant: "error",
        duration: 6000,
      });
      return;
    }

    showToast({
      title: "Champ modifié",
      description: "Le champ a été mis à jour.",
      variant: "success",
      duration: 2500,
    });

    onChanged?.();
  }

  async function moveFieldPersisted(clientId: string, dir: -1 | 1) {
    if (!event?.id || isSaving || !isCurrentScope()) return;
    const revision = ++orderRevisionRef.current;

    const sortedDraft = [...draft].sort((a, b) => {
      const diff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });

    const current = sortedDraft.find((f) => f.clientId === clientId);
    if (!current?.id) return;

    const sameGroup = sortedDraft.filter(
      (f) => (f.groupId ?? null) === (current.groupId ?? null)
    );

    const idx = sameGroup.findIndex((f) => f.clientId === clientId);
    if (idx < 0) return;

    const targetIdx = idx + dir;
    if (targetIdx < 0 || targetIdx >= sameGroup.length) return;

    const target = sameGroup[targetIdx];
    if (!target?.id) return;

    const currentSort = clampInt(current.sortOrder, { fallback: 0 });
    const targetSort = clampInt(target.sortOrder, { fallback: 0 });
    try {
      setDraft((prev) =>
        prev.map((f) => {
          if (f.clientId === current.clientId) {
            return { ...f, sortOrder: targetSort };
          }
          if (f.clientId === target.clientId) {
            return { ...f, sortOrder: currentSort };
          }
          return f;
        })
      );

      const aDir: MoveDir = dir === -1 ? "up" : "down";
      const bDir: MoveDir = dir === -1 ? "down" : "up";

      await reorder.reorderEventForm({
        eventId: event.id,
        fields: [
          { id: current.id, sortOrder: targetSort },
          { id: target.id, sortOrder: currentSort },
        ],
      });
      if (!isCurrentScope() || revision !== orderRevisionRef.current) return;

      triggerMoveAnim(current.clientId, aDir, target.clientId, bDir);

      showToast({
        title: "Champ déplacé",
        description: "L’ordre des champs a été mis à jour.",
        variant: "success",
        duration: 2500,
      });

      // pas de onChanged ici, sinon reload + perte de scroll
    } catch (e) {
      if (!isCurrentScope() || revision !== orderRevisionRef.current) return;
      setDraft((previous) => previous.map((field) => {
        if (field.clientId === current.clientId) return { ...field, sortOrder: currentSort };
        if (field.clientId === target.clientId) return { ...field, sortOrder: targetSort };
        return field;
      }));
      if (e instanceof OrganizerMutationObsoleteError) return;
      showToast({
        title: "Réordonnancement impossible",
        description: e instanceof Error ? e.message : "Erreur inconnue",
        variant: "error",
        duration: 6000,
      });
    }
  }

  async function deleteFieldPersisted(field: DraftField) {
    if (isSaving || !isCurrentScope()) return;
    const revision = editorRevisionRef.current;

    const ok = await del.deleteEventFormField({ id: field.id });
    if (!isCurrentScope()) return;

    if (!ok) {
      showToast({
        title: "Suppression impossible",
        description: del.error || "Impossible de supprimer le champ.",
        variant: "error",
        duration: 6000,
      });
      return;
    }

    if (revision === editorRevisionRef.current && editing?.id === field.clientId) closeEditor();

    showToast({
      title: "Champ supprimé",
      description: "Le champ a été supprimé du formulaire.",
      variant: "success",
      duration: 3000,
    });

    onChanged?.();
  }

  async function saveFieldEditor() {
    if (!event?.id || !editing || isSaving || !isCurrentScope()) return;
    const revision = editorRevisionRef.current;

    const label = editing.label.trim();
    if (!label) return;

    const options = buildOptions(editing.fieldType, editing.optionsText);

    if (creating) {
      const created = await create.createEventFormField({
        eventId: event.id,
        label,
        fieldKey: buildKeyFromLabel(label),
        fieldType: editing.fieldType,
        groupId: editing.groupId ?? null,
        isRequired: editing.isRequired,
        isActive: editing.isActive,
        sortOrder: draft.length + 1,
        options,
      });
      if (!isCurrentScope() || revision !== editorRevisionRef.current) return;

      if (!created.ok) {
        showToast({
          title: "Création impossible",
          description: created.error,
          variant: "error",
          duration: 6000,
        });
        return;
      }

      showToast({
        title: "Champ créé",
        description: "Le champ a été ajouté au formulaire.",
        variant: "success",
        duration: 3000,
      });

      closeEditor();
      onChanged?.();
      return;
    }

    const current = draft.find((f) => f.clientId === editing.id);
    if (!current?.id) return;

    const result = await update.updateEventFormField({
      fieldId: current.id,
      patch: {
        label,
        fieldType: editing.fieldType,
        groupId: editing.groupId ?? null,
        isRequired: editing.isRequired,
        isActive: editing.isActive,
        options,
      },
    });
    if (!isCurrentScope() || revision !== editorRevisionRef.current) return;

    if (!result.ok) {
      showToast({
        title: "Modification impossible",
        description: result.error,
        variant: "error",
        duration: 6000,
      });
      return;
    }

    showToast({
      title: "Champ modifié",
      description: "Le champ a été mis à jour.",
      variant: "success",
      duration: 3000,
    });

    closeEditor();
    onChanged?.();
  }

  function groupHasFields(groupId: string) {
    return draft.some((f) => f.groupId === groupId);
  }

  async function saveGroupEditor() {
    if (!editingGroup || isSaving || !isCurrentScope()) return;
    const revision = editorRevisionRef.current;

    const label = editingGroup.label.trim();
    if (!label) return;

    const updated = await updateGroup.updateEventFormFieldGroup({
      groupId: editingGroup.id,
      patch: {
        label,
        description: editingGroup.description.trim() || null,
        isActive: editingGroup.isActive,
        sortOrder: editingGroup.sortOrder,
      },
    });
    if (!isCurrentScope() || revision !== editorRevisionRef.current) return;

    if (!updated) {
      showToast({
        title: "Modification impossible",
        description: updateGroup.error || "Impossible de modifier le groupe.",
        variant: "error",
        duration: 6000,
      });
      return;
    }

    showToast({
      title: "Groupe modifié",
      description: "Le groupe a été modifié avec succès.",
      variant: "success",
      duration: 3500,
    });

    closeEditor();
    onChanged?.();
  }

  async function handleCreateGroup() {
    if (!event?.id || isSaving || !isCurrentScope()) return;
    const revision = editorRevisionRef.current;

    const label = newGroupLabel.trim();
    if (!label) return;

    const nextSortOrder =
      (fieldsGroups.length > 0
        ? Math.max(...fieldsGroups.map((g) => g.sortOrder ?? 0))
        : 0) + 1;

    const created = await createGroup.createEventFormFieldGroup({
      eventId: event.id,
      label,
      description: newGroupDescription.trim() || null,
      sortOrder: nextSortOrder,
      isActive: true,
    });
    if (!isCurrentScope() || revision !== editorRevisionRef.current) return;

    if (!created) {
      showToast({
        title: "Création impossible",
        description: createGroup.error || "Impossible de créer le groupe.",
        variant: "error",
        duration: 6000,
      });
      return;
    }

    showToast({
      title: "Groupe créé",
      description: "Le groupe a été ajouté au formulaire.",
      variant: "success",
      duration: 3500,
    });

    setNewGroupLabel("");
    setNewGroupDescription("");
    onChanged?.();
  }

  async function handleDeleteGroup(group: EventFormFieldGroup) {
    if (isSaving || !isCurrentScope()) return;
    const revision = editorRevisionRef.current;

    const hasFields = draft.some((f) => f.groupId === group.id);

    if (hasFields) {
      showToast({
        title: "Suppression impossible",
        description: "Ce groupe contient encore des champs. Retire-les du groupe avant suppression.",
        variant: "error",
        duration: 6000,
      });
      return;
    }

    const ok = await deleteGroup.deleteEventFormFieldGroup({ id: group.id });
    if (!isCurrentScope()) return;

    if (!ok) {
      showToast({
        title: "Suppression impossible",
        description: deleteGroup.error || "Impossible de supprimer le groupe.",
        variant: "error",
        duration: 6000,
      });
      return;
    }

    if (revision === editorRevisionRef.current && editingKind === "group" && editingGroup?.id === group.id) {
      closeEditor();
    }

    showToast({
      title: "Groupe supprimé",
      description: "Le groupe a été supprimé.",
      variant: "success",
      duration: 3000,
    });

    onChanged?.();
  }

  async function toggleGroupActive(group: EventFormFieldGroup) {
    if (isSaving || !isCurrentScope()) return;

    const updated = await updateGroup.updateEventFormFieldGroup({
      groupId: group.id,
      patch: { isActive: !group.isActive },
    });
    if (!isCurrentScope()) return;

    if (!updated) {
      showToast({
        title: "Modification impossible",
        description: updateGroup.error || "Impossible de modifier le groupe.",
        variant: "error",
        duration: 6000,
      });
      return;
    }

    showToast({
      title: group.isActive ? "Groupe désactivé" : "Groupe activé",
      description: "Le groupe a été mis à jour.",
      variant: "success",
      duration: 2500,
    });

    onChanged?.();
  }

  async function moveGroup(group: EventFormFieldGroup, dir: -1 | 1) {
    if (!event?.id || isSaving || !isCurrentScope()) return;

    const sorted = [...fieldsGroups].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    );

    const idx = sorted.findIndex((g) => g.id === group.id);
    if (idx < 0) return;

    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= sorted.length) return;

    const current = sorted[idx];
    const target = sorted[nextIdx];

    const currentOrder = clampInt(current.sortOrder ?? idx + 1, {
      fallback: idx + 1,
    });

    const targetOrder = clampInt(target.sortOrder ?? nextIdx + 1, {
      fallback: nextIdx + 1,
    });

    try {
      await reorder.reorderEventForm({
        eventId: event.id,
        groups: [
          { id: current.id, sortOrder: targetOrder },
          { id: target.id, sortOrder: currentOrder },
        ],
      });
      if (!isCurrentScope()) return;
    } catch (error: unknown) {
      if (!isCurrentScope() || error instanceof OrganizerMutationObsoleteError) return;
      showToast({
        title: "Réordonnancement impossible",
        description: error instanceof Error ? error.message : "Impossible de réordonner le groupe.",
        variant: "error", duration: 6000,
      });
      return;
    }

    showToast({
      title: "Groupe déplacé",
      description: "L’ordre des groupes a été mis à jour.",
      variant: "success",
      duration: 2500,
    });

    onChanged?.();
  }

  const isOpen = Boolean(editing || editingGroup);
  const editingId = editing?.id ?? editingGroup?.id ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return draft;

    return draft.filter((f) => {
      const label = String(f.label ?? "").toLowerCase();
      const key = String(f.fieldKey ?? "").toLowerCase();
      const type = String(f.fieldType ?? "").toLowerCase();
      return label.includes(q) || key.includes(q) || type.includes(q);
    });
  }, [draft, query]);

    const filteredSorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const diff = (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      if (diff !== 0) return diff;
      return String(a.id).localeCompare(String(b.id));
    });
  }, [filtered]);


  const groupedSections = useMemo(() => {
    const groupsSorted = [...fieldsGroups].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
    );

    const groupIds = new Set(groupsSorted.map((g) => g.id));

    const ungrouped = filteredSorted.filter((f) => {
      if (!f.groupId) return true;
      return !groupIds.has(f.groupId);
    });

    let grouped = groupsSorted.map((group) => ({
      group,
      fields: filteredSorted.filter((f) => f.groupId === group.id),
    }));

    

    if (isFiltering) {
      grouped = grouped.filter((section) => section.fields.length > 0);
    }

    if (ungrouped.length > 0) {
      return [
        {
          group: null as EventFormFieldGroup | null,
          fields: ungrouped,
        },
        ...grouped,
      ];
    }

    return grouped;
  }, [filteredSorted, fieldsGroups, isFiltering]);


  const reorderDisabledTitle = isFiltering
    ? "Le réordonnancement est désactivé pendant une recherche."
    : undefined;

  const groupEditorNode = editingGroup ? (
    <div className="adminRegEditorCard">
      <div className="adminRegEditorHeader">
        <div>
          <div className="adminRegEditorTitle">Modifier groupe</div>
          <div className="adminEventHint">
            Ce groupe permet d’organiser les champs du formulaire.
          </div>
        </div>

        <Button
          variant="ghost"
          className="adminRegEditorClose"
          onClick={closeEditor}
          aria-label="Fermer"
        >
          ✕
        </Button>
      </div>

      <div className="adminEventFormGrid adminRegEditorFormGrid">
        <div className="adminEventField">
          <div className="adminEventLabel">Label</div>
          <input
            className="adminEventInput"
            value={editingGroup.label}
            onChange={(e) => setEditingGroup({ ...editingGroup, label: e.target.value })}
            disabled={isSaving}
            maxLength={100}
          />
        </div>

        <div className="adminEventField adminEventFieldSpan2">
          <div className="adminEventLabel">Description</div>
          <textarea
            className="adminEventTextarea"
            value={editingGroup.description}
            onChange={(e) =>
              setEditingGroup({ ...editingGroup, description: e.target.value })
            }
            disabled={isSaving}
            rows={3}
            maxLength={300}
            placeholder="Texte d’aide affiché sous le titre du groupe (optionnel)"
          />
        </div>

        <div className="adminEventField">
          <label className="adminRegCheckRow">
            <input
              type="checkbox"
              checked={editingGroup.isActive}
              onChange={(e) =>
                setEditingGroup({ ...editingGroup, isActive: e.target.checked })
              }
              disabled={isSaving}
            />
            <span>Actif</span>
          </label>
        </div>
      </div>

      <div className="adminRegEditorFooter">
        <Button variant="secondary" onClick={closeEditor} disabled={isSaving}>
          Annuler
        </Button>

        <Button
          variant="primary"
          onClick={saveGroupEditor}
          disabled={!editingGroup.label.trim() || isSaving}
        >
          Enregistrer
        </Button>
      </div>
    </div>
  ) : null;

  const fieldEditorNode = editing ? (
    <div className="adminRegEditorCard">
      <div className="adminRegEditorHeader">
        <div>
          <div className="adminRegEditorTitle">
            {creating ? "Nouveau champ" : "Modifier champ"}
          </div>
          <div className="adminEventHint">
            Pour <code>liste déroulante</code>/<code>radio</code> : une option par ligne.
          </div>
        </div>

        <Button
          variant="ghost"
          className="adminRegEditorClose"
          onClick={closeEditor}
          aria-label="Fermer"
        >
          ✕
        </Button>
      </div>

      <div className="adminEventFormGrid adminRegEditorFormGrid">
        <div className="adminEventField">
          <div className="adminEventLabel">Label</div>
          <input
            className="adminEventInput"
            value={editing.label}
            onChange={(e) => setEditing({ ...editing, label: e.target.value })}
            disabled={isSaving}
            maxLength={100}
          />
        </div>

        <div className="adminEventField">
          <div className="adminEventLabel">Type</div>
          <select
            className="adminEventInput"
            value={editing.fieldType}
            onChange={(e) => setEditing({ ...editing, fieldType: e.target.value as FieldType })}
            disabled={isSaving}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="adminEventField">
          <div className="adminEventLabel">Groupe</div>
          <select
            className="adminEventInput"
            value={editing.groupId ?? ""}
            onChange={(e) =>
              setEditing({
                ...editing,
                groupId: e.target.value ? e.target.value : null,
              })
            }
            disabled={isSaving}
          >
            <option value="">Sans groupe</option>
            {sortedGroups
              .filter((g) => g.isActive)
              .map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
          </select>
        </div>

        <div className="adminEventField">
          <div className="adminRegChecksInline">
            <label className="adminRegCheckRow">
              <input
                type="checkbox"
                checked={editing.isRequired}
                onChange={(e) => setEditing({ ...editing, isRequired: e.target.checked })}
                disabled={isSaving}
              />
              <span>Requis</span>
            </label>

            <label className="adminRegCheckRow">
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                disabled={isSaving}
              />
              <span>Actif</span>
            </label>
          </div>
        </div>

        {editing.fieldType === "select" ? (
          <div className="adminEventField adminEventFieldSpan2">
            <div className="adminEventLabel">Options</div>
            <textarea
              placeholder="Une option par ligne"
              className="adminEventTextarea"
              value={editing.optionsText}
              onChange={(e) => setEditing({ ...editing, optionsText: e.target.value })}
              disabled={isSaving}
            />
          </div>
        ) : null}
      </div>

      <div className="adminRegEditorFooter">
        <Button variant="secondary" onClick={closeEditor} disabled={isSaving}>
          Annuler
        </Button>

        <Button
          variant="primary"
          onClick={saveFieldEditor}
          disabled={!editing.label.trim() || isSaving}
        >
          {creating ? "Ajouter" : "Enregistrer"}
        </Button>
      </div>
    </div>
  ) : null;

  const editorNode = editingKind === "group" ? groupEditorNode : fieldEditorNode;

  function renderFieldCard(f: DraftField, mobile = false) {
    const sameGroup = filteredSorted.filter(
      (x) => (x.groupId ?? null) === (f.groupId ?? null)
    );

    const groupIdx = sameGroup.findIndex((x) => x.clientId === f.clientId);

    const canMoveUp = groupIdx > 0;
    const canMoveDown = groupIdx < sameGroup.length - 1;

    const active = Boolean(f.isActive ?? true);
    const required = Boolean(f.isRequired ?? false);
    const type = String(f.fieldType ?? "text");

    const optsLine =
      type === "select" || type === "radio"
        ? optionsToInlineText(f.options ?? undefined, 80)
        : null;

    const animDir = moveAnim[f.clientId];

    const cardAnimClass =
      animDir === "up" ? "isMoveUp" : animDir === "down" ? "isMoveDown" : "";

    const showEditInline =
      mobile &&
      ((isOpen && !creating && editingId === f.clientId) ||
        (isClosing && closingKey === f.clientId));

    return (
      <div key={f.clientId} className={mobile ? "adminRegBlock" : undefined}>
        <div
          className={[
            active ? "adminRegCard" : "adminRegCard isInactive",
            cardAnimClass,
          ].join(" ")}
        >
          <div className="adminRegTop">
            <div className="adminRegTitleLine">{f.label}</div>

            <div className="adminRegPills">
              <span className={active ? "adminRegPill" : "adminRegPill isOff"}>
                {active ? "Actif" : "Inactif"}
              </span>
              <span className={required ? "adminRegPill isReq" : "adminRegPill isOpt"}>
                {required ? "Requis" : "Optionnel"}
              </span>
            </div>
          </div>

          <div className="adminRegMeta">
            <span>Type : {type}</span>
            {optsLine ? <span className="adminRegOptionsInline">• {optsLine}</span> : null}
          </div>

          <div className="adminRegActions">
            <Button variant="secondary" onClick={() => openEdit(f)} disabled={isSaving}>
              Modifier
            </Button>

            <Button
              onClick={() => toggleFieldPersisted(f, { isRequired: !required })}
              disabled={isSaving}
              variant="secondary"
            >
              {required ? "Rendre optionnel" : "Rendre requis"}
            </Button>

            <Button
              onClick={() => toggleFieldPersisted(f, { isActive: !active })}
              disabled={isSaving}
              variant="secondary"
            >
              {active ? "Désactiver" : "Activer"}
            </Button>

            <Button
              onClick={() => moveFieldPersisted(f.clientId, -1)}
              disabled={isSaving || isFiltering || !canMoveUp}
              title={isFiltering ? reorderDisabledTitle : undefined}
              className="adminMoveBtn"
              aria-label="Monter"
              variant="secondary"
            >
              ↑
            </Button>

            <Button
              onClick={() => moveFieldPersisted(f.clientId, 1)}
              disabled={isSaving || isFiltering || !canMoveDown}
              title={isFiltering ? reorderDisabledTitle : undefined}
              className="adminMoveBtn"
              aria-label="Descendre"
              variant="secondary"
            >
              ↓
            </Button>

            <Button
              variant="danger"
              className="deleteFormFieldButton"
              onClick={() => deleteFieldPersisted(f)}
              disabled={isSaving}
            >
              <TrashIcon />
            </Button>
          </div>
        </div>

        {mobile && showEditInline ? (
          <div
            className={[
              "adminRegInlineEditor",
              "isEdit",
              isClosing && closingKey === f.clientId ? "isClosing" : "isOpen",
            ].join(" ")}
          >
            {editorNode}
          </div>
        ) : null}
      </div>
    );
  }

  const showCreateInline = (isOpen && creating) || (isClosing && closingKey === "create");

  const subtitle =
    "Gérez les informations que les participants devront fournir lors de leur inscription à l’événement.";

  function renderGroupActions(group: EventFormFieldGroup) {
    return (
      <div className="adminRegGroupActions">
        <Button
          className="adminRegGroupBtn"
          variant="secondary"
          onClick={() => openEditGroup(group)}
          disabled={isSaving}
        >
          Modifier
        </Button>

        <Button
          className="adminRegGroupBtn"
          variant="secondary"
          onClick={() => toggleGroupActive(group)}
          disabled={isSaving}
        >
          {group.isActive ? "Désactiver" : "Activer"}
        </Button>

        <Button
          className="adminRegGroupBtn adminRegGroupBtnIcon"
          variant="secondary"
          onClick={() => moveGroup(group, -1)}
          disabled={isSaving}
        >
          ↑
        </Button>

        <Button
          className="adminRegGroupBtn adminRegGroupBtnIcon"
          variant="secondary"
          onClick={() => moveGroup(group, 1)}
          disabled={isSaving}
        >
          ↓
        </Button>

        <Button
          className="adminRegGroupBtnDanger"
          variant="danger"
          onClick={() => handleDeleteGroup(group)}
          disabled={isSaving || groupHasFields(group.id)}
          title={
            groupHasFields(group.id)
              ? "Ce groupe contient encore des champs"
              : undefined
          }
        >
          <TrashIcon />
        </Button>
      </div>
    );
  }

  function renderSections(mobile: boolean) {
    if (draft.length === 0) {
      return <div className="adminEventEmpty">Aucun champ. Clique “Ajouter un champ”.</div>;
    }

    if (filtered.length === 0) {
      return (
        <div className="adminEventEmpty">
          Aucun champ ne correspond à “{query.trim()}”.
        </div>
      );
    }

    return groupedSections.map((section) => {
      const group = section.group;

      return (
        <div key={group?.id ?? "ungrouped"} className="adminRegGroupSection">
          <div className="adminRegGroupHeaderRow">
            <div className="adminRegGroupHeaderBlock">
              <div className="adminRegGroupHeader">
                {group ? group.label : "Sans groupe"}
              </div>

              {group?.description ? (
                <div className="adminRegGroupDescription">{group.description}</div>
              ) : null}
            </div>

            {group ? renderGroupActions(group) : null}
          </div>

          <div className="adminRegGroupList">
            {section.fields.map((f) => renderFieldCard(f, mobile))}
          </div>
        </div>
      );
    });
  }

  return (
    <FlexPanel
      title="Formulaire d’inscription"
      subtitle={subtitle}
      state="default"
      actions={
        <div className="adminRegActionsWrap">
          <div className="adminRegActionsRow">
            <Button
              onClick={openCreate}
              disabled={!event?.id || isSaving}
              variant="secondary"
            >
              Ajouter un champ
            </Button>
          </div>

          <div className="adminRegActionsRow adminRegActionsRowGroup">
            <input
              className="adminEventInput"
              placeholder="Nom du groupe…"
              value={newGroupLabel}
              onChange={(e) => setNewGroupLabel(e.target.value)}
              disabled={!event?.id || isSaving}
              maxLength={100}
            />

            <Button
              onClick={handleCreateGroup}
              disabled={!event?.id || isSaving || !newGroupLabel.trim()}
              variant="secondary"
            >
              Ajouter un groupe
            </Button>
          </div>
        </div>
      }
    >
      <FilterBar query={query} onQueryChange={setQuery} placeholder="Rechercher un champ…" />

      {isMobile ? (
        <div
          className={
            isOpen || isClosing
              ? "adminRegInlineShell isEditorOpen"
              : "adminRegInlineShell"
          }
        >
          {showCreateInline ? (
            <div
              className={[
                "adminRegInlineEditor",
                "isCreate",
                isClosing && closingKey === "create" ? "isClosing" : "isOpen",
              ].join(" ")}
            >
              {editorNode}
            </div>
          ) : null}

          <div className="adminRegList">{renderSections(true)}</div>
        </div>
      ) : (
        <EditorShell
          isOpen={isOpen}
          onRequestClose={closeEditor}
          editorWidth={420}
          editorGap={14}
          stickyTop={120}
          left={<div className="adminRegList">{renderSections(false)}</div>}
          right={
            isOpen ? (
              <div className="regEditorPanel isOpen">
                <div className="regEditorPanelInner">{editorNode}</div>
              </div>
            ) : null
          }
        />
      )}
    </FlexPanel>
  );
}
